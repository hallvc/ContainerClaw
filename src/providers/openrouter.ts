import type { LLMProvider, LLMResponse, ToolCallRequest } from "./base.ts";
import type { MessageContent } from "./content.ts";
import type { OpenRouterClient } from "./openrouter_client.ts";
import { jsonrepair } from "jsonrepair";

const INITIAL_RESPONSE_TIMEOUT_MS = 30_000; // 30s for initial HTTP connection
const STREAM_CHUNK_TIMEOUT_MS = 120_000; // 2min idle between SSE chunks

interface OpenRouterChoice {
  message: {
    content: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{
      id: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
  finish_reason: string;
}

interface OpenRouterResponseBody {
  choices: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message: string };
}

// Streaming SSE types
interface StreamDelta {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface StreamChoice {
  index: number;
  delta: StreamDelta;
  finish_reason: string | null;
}

interface StreamChunk {
  choices?: StreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(jsonrepair(raw));
    } catch {
      console.warn(`Failed to parse tool arguments: ${raw.slice(0, 200)}`);
      return {};
    }
  }
}

/**
 * Async generator that consumes an SSE stream and yields parsed StreamChunk objects.
 * Handles keepalive comments, empty lines, and malformed chunks gracefully.
 */
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
): AsyncGenerator<StreamChunk> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Stream idle timeout after ${idleTimeoutMs}ms`));
        }, idleTimeoutMs);
      });

      let result: ReadableStreamReadResult<string>;
      try {
        result = await Promise.race([reader.read(), timeoutPromise]);
      } finally {
        clearTimeout(timeoutId!);
      }

      if (result.done) break;

      buffer += result.value;
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith(":")) continue;

        if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") return;

          try {
            yield JSON.parse(payload) as StreamChunk;
          } catch {
            console.warn(`Malformed SSE chunk: ${payload.slice(0, 200)}`);
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Consumes an SSE stream and assembles a complete LLMResponse.
 */
async function accumulateStream(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
): Promise<LLMResponse> {
  let content = "";
  let reasoning = "";
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason = "stop";
  let usage:
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;

  for await (const chunk of parseSSEStream(body, idleTimeoutMs)) {
    if (!chunk.choices?.length) {
      if (chunk.usage) usage = chunk.usage;
      continue;
    }

    const choice = chunk.choices[0];
    const delta = choice.delta;

    if (delta.content) content += delta.content;
    if (delta.reasoning_content) reasoning += delta.reasoning_content;
    else if (delta.reasoning) reasoning += delta.reasoning;

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const existing = toolCallMap.get(tc.index);
        if (existing) {
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        } else {
          toolCallMap.set(tc.index, {
            id: tc.id ?? "",
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "",
          });
        }
      }
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  }

  const toolCalls: ToolCallRequest[] = Array.from(toolCallMap.values()).map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: parseToolArguments(tc.arguments),
  }));

  return {
    content: content || null,
    reasoning_content: reasoning || null,
    toolCalls,
    finishReason,
    usage: {
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    },
  };
}

export class OpenRouterProvider implements LLMProvider {
  private readonly client: OpenRouterClient;
  private readonly defaultModel: string;

  constructor(client: OpenRouterClient, defaultModel: string) {
    this.client = client;
    this.defaultModel = defaultModel;
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async chat(params: {
    messages: Array<{
      role: string;
      content: MessageContent;
      tool_calls?: unknown[];
      tool_call_id?: string;
      name?: string;
    }>;
    tools?: unknown[];
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: params.model ?? this.defaultModel,
      messages: params.messages,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      stream: true,
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = "auto";
    }

    try {
      const response = await this.client.postJSON("/chat/completions", body, {
        timeoutMs: INITIAL_RESPONSE_TIMEOUT_MS,
        accept: "text/event-stream",
      });

      const contentType = response.headers.get("content-type") ?? "";

      // SSE streaming response
      if (contentType.includes("text/event-stream")) {
        if (!response.body) {
          return {
            content: "No response body from streaming request",
            toolCalls: [],
            finishReason: "error",
            usage: {},
          };
        }
        return await accumulateStream(response.body, STREAM_CHUNK_TIMEOUT_MS);
      }

      // Non-streaming JSON response (error responses, fallback)
      const data: OpenRouterResponseBody = await response.json();

      if (!response.ok || data.error) {
        const msg = data.error?.message ?? `HTTP ${response.status}`;
        return {
          content: msg,
          toolCalls: [],
          finishReason: "error",
          usage: {},
        };
      }

      if (!data.choices?.length) {
        return {
          content: "Empty response from model (no choices returned)",
          toolCalls: [],
          finishReason: "error",
          usage: {},
        };
      }

      const choice = data.choices[0];
      const toolCalls: ToolCallRequest[] = (choice.message.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: parseToolArguments(tc.function.arguments),
      }));

      return {
        content: choice.message.content ?? null,
        reasoning_content: choice.message.reasoning_content ?? null,
        toolCalls,
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: msg,
        toolCalls: [],
        finishReason: "error",
        usage: {},
      };
    }
  }
}
