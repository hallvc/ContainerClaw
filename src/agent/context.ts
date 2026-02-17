import { join } from "@std/path";
import type { MemoryStore } from "./memory.ts";
import type { SkillsLoader } from "./skills.ts";
import type { ToolCallRequest } from "../providers/base.ts";

interface ChatMessage {
  role: string;
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

const BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"];

export class ContextBuilder {
  private workspace: string;
  private memory: MemoryStore;
  private skills: SkillsLoader | null;
  private messages: ChatMessage[] = [];

  constructor(workspace: string, memory: MemoryStore, skills?: SkillsLoader) {
    this.workspace = workspace;
    this.memory = memory;
    this.skills = skills ?? null;
  }

  private async loadBootstrapFiles(): Promise<string> {
    const parts: string[] = [];
    for (const filename of BOOTSTRAP_FILES) {
      try {
        const content = await Deno.readTextFile(join(this.workspace, filename));
        if (content.trim()) {
          parts.push(`## ${filename}\n\n${content.trim()}`);
        }
      } catch {
        // File doesn't exist, skip
      }
    }
    return parts.join("\n\n---\n\n");
  }

  async buildMessages(
    history: Array<{ role: string; content: string }>,
    currentMessage: string,
    media: string[],
  ): Promise<ChatMessage[]> {
    const systemPrompt = await this.buildSystemPrompt();
    this.messages = [];

    // System message
    this.messages.push({ role: "system", content: systemPrompt });

    // History
    for (const msg of history) {
      this.messages.push({ role: msg.role, content: msg.content });
    }

    // Current user message (with optional media)
    if (media.length > 0) {
      // For vision models, include image URLs
      const mediaNote = media.map((url) => `[Attached: ${url}]`).join("\n");
      this.messages.push({
        role: "user",
        content: `${currentMessage}\n\n${mediaNote}`,
      });
    } else {
      this.messages.push({ role: "user", content: currentMessage });
    }

    return this.messages;
  }

  private async buildSystemPrompt(): Promise<string> {
    const parts: string[] = [];

    parts.push("You are a helpful AI assistant running inside a containerized environment.");
    parts.push("You have access to tools for file operations, shell commands, web search, and messaging.");
    parts.push("Always be concise and helpful. Use tools when needed to accomplish tasks.");

    const bootstrap = await this.loadBootstrapFiles();
    if (bootstrap) {
      parts.push(bootstrap);
    }

    const memoryContext = await this.memory.getMemoryContext();
    if (memoryContext) {
      parts.push(memoryContext);
    }

    if (this.skills) {
      const alwaysSkills = await this.skills.getAlwaysSkills();
      if (alwaysSkills.length > 0) {
        const alwaysContent = await this.skills.loadSkillsForContext(alwaysSkills);
        parts.push(alwaysContent);
      }
      const summary = await this.skills.buildSkillsSummary();
      if (summary) {
        parts.push(`## Available Skills\n\n${summary}`);
      }
    }

    parts.push(`Current date: ${new Date().toISOString().split("T")[0]}`);
    parts.push(`Workspace directory: ${this.workspace}`);

    return parts.join("\n\n");
  }

  addToolResult(toolCallId: string, toolName: string, result: string): void {
    this.messages.push({
      role: "tool",
      content: result,
      tool_call_id: toolCallId,
      name: toolName,
    });
  }

  addAssistantMessage(
    content: string | null,
    toolCalls: ToolCallRequest[],
    reasoningContent?: string | null,
  ): void {
    const msg: ChatMessage = {
      role: "assistant",
      content,
    };

    // Thinking models reject history without this
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }

    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    this.messages.push(msg);
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }
}
