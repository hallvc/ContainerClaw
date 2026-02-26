export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCallRequest[];
  finishReason: string;
  reasoning_content?: string | null; // Kimi, DeepSeek-R1, etc.
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

import type { MessageContent } from "./content.ts";

export interface LLMProvider {
  chat(params: {
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
  }): Promise<LLMResponse>;

  getDefaultModel(): string;
}
