import type { LLMProvider, LLMResponse, ToolCallRequest } from "./base.ts";
import { jsonrepair } from "jsonrepair";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 8000;

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
 * Retry a fetch call with exponential backoff.
 * - Retries on network errors (fetch throws) and HTTP 429/5xx.
 * - Does NOT retry on TimeoutError or HTTP 4xx (except 429).
 * - On exhaustion of retries for 429/5xx, returns the last response so the
 *   caller's existing error-handling branch (data.error / !response.ok) applies.
 */
async function withRetry(
  fn: () => Promise<Response>,
): Promise<Response> {
  let lastNetworkError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fn();

      // Retry on 429 and 5xx
      if (response.status === 429 || response.status >= 500) {
        lastResponse = response;
        if (attempt < RETRY_MAX_ATTEMPTS - 1) {
          const jitter = Math.random() * 200;
          const delay = Math.min(
            RETRY_INITIAL_DELAY_MS * Math.pow(2, attempt) + jitter,
            RETRY_MAX_DELAY_MS,
          );
          console.warn(
            `Retrying after HTTP ${response.status} (attempt ${attempt + 1}): HTTP ${response.status}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        // Exhausted retries — return last response so caller handles it
        return lastResponse;
      }

      return response;
    } catch (err) {
      // Do not retry TimeoutError
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw err;
      }
      lastNetworkError = err;
      if (attempt < RETRY_MAX_ATTEMPTS - 1) {
        const jitter = Math.random() * 200;
        const delay = Math.min(
          RETRY_INITIAL_DELAY_MS * Math.pow(2, attempt) + jitter,
          RETRY_MAX_DELAY_MS,
        );
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Retrying after error (attempt ${attempt + 1}): ${msg}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted on network error
  throw lastNetworkError;
}

export class OpenRouterProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(apiKey: string, defaultModel: string) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async chat(params: {
    messages: Array<{
      role: string;
      content: string | null;
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
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = "auto";
    }

    try {
      const response = await withRetry(() =>
        fetch(API_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/containerclaw/containerclaw",
            "X-Title": "containerclaw",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        })
      );

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
