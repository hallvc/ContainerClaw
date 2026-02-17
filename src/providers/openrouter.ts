import type { LLMProvider, LLMResponse, ToolCallRequest } from "./base.ts";
import { jsonrepair } from "jsonrepair";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

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
      return {};
    }
  }
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
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/containerclaw/nanobot",
          "X-Title": "nanobot",
        },
        body: JSON.stringify(body),
      });

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
