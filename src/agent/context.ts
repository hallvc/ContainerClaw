import { join } from "@std/path";
import type { MemoryStore } from "./memory.ts";
import type { SkillsLoader } from "./skills.ts";
import type { ToolCallRequest } from "../providers/base.ts";
import type { MessageContent } from "../providers/content.ts";
import { buildContentParts } from "../providers/media.ts";

interface ChatMessage {
  role: string;
  content: MessageContent;
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
    const systemPrompt = await this.buildSystemPrompt(currentMessage);
    this.messages = [];

    // System message
    this.messages.push({ role: "system", content: systemPrompt });

    // History
    for (const msg of history) {
      this.messages.push({ role: msg.role, content: msg.content });
    }

    // Current user message (with optional media)
    if (media.length > 0) {
      const content = await buildContentParts(currentMessage, media);
      this.messages.push({ role: "user", content });
    } else {
      this.messages.push({ role: "user", content: currentMessage });
    }

    return this.messages;
  }

  private async buildSystemPrompt(currentMessage?: string): Promise<string> {
    const parts: string[] = [];

    parts.push("You are a helpful AI assistant running inside a containerized environment.");
    parts.push("You have access to tools for file operations, shell commands, web search, messaging, and a `learn` tool to save important knowledge to persistent memory.");
    parts.push("Always be concise and helpful. Use tools when needed to accomplish tasks.");
    parts.push("Use the `learn` tool when: a user corrects you, you discover a non-obvious pattern, or a preference should be remembered forever.");

    const bootstrap = await this.loadBootstrapFiles();
    if (bootstrap) {
      parts.push(bootstrap);
    }

    // Smart context loading: if we have a current message, load relevant context
    // Otherwise fall back to loading all of MEMORY.md (legacy behavior)
    if (currentMessage) {
      const relevantContext = await this.memory.getRelevantContext(currentMessage);
      if (relevantContext) {
        parts.push(relevantContext);
      }
    } else {
      const memoryContext = await this.memory.getMemoryContext();
      if (memoryContext) {
        parts.push(memoryContext);
      }
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

  addUserHint(content: string): void {
    this.messages.push({ role: "user", content });
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  /**
   * Inject planning-mode instructions into the system prompt.
   * Called during the planning loop to tell the LLM to assess complexity and
   * either execute directly (Tier 1) or present a plan and stop (Tier 2+).
   */
  addPlanningInstructions(forceTier4: boolean): void {
    const instructions = forceTier4
      ? PLANNING_INSTRUCTIONS_TIER4
      : PLANNING_INSTRUCTIONS_AUTO;
    // Prepend as a system-level message so it comes before conversation history
    this.messages.splice(1, 0, { role: "system", content: instructions });
  }

  /**
   * Inject execution-mode instructions with the approved plan.
   * Called during the execution loop after the user confirms a plan.
   */
  addExecutionInstructions(planText: string): void {
    const instructions = EXECUTION_INSTRUCTIONS.replace("{{PLAN}}", planText);
    this.messages.splice(1, 0, { role: "system", content: instructions });
  }

  /**
   * Inject plan-modification instructions when the user wants changes to a proposed plan.
   */
  addPlanModificationInstructions(originalPlan: string, userFeedback: string): void {
    const instructions = PLAN_MODIFICATION_INSTRUCTIONS
      .replace("{{PLAN}}", originalPlan)
      .replace("{{FEEDBACK}}", userFeedback);
    this.messages.splice(1, 0, { role: "system", content: instructions });
  }
}

// --- Planning prompt fragments ---

const PLANNING_INSTRUCTIONS_AUTO = `## Task Planning Protocol

Before executing any tools, assess the complexity of the user's request:

**Tier 1 (Direct Execution):** The task needs 0-1 tool calls and has one clear answer.
→ Proceed normally. Execute tools and respond.

**Tier 2 (Plan Preview):** The task needs 2-3 tool calls with a well-defined goal.
→ Use the \`message\` tool to send the user a numbered plan (3-6 steps). End with "Reply 'go' to start, or tell me what to change." Then STOP — do not execute any other tools.

**Tier 3 (Interactive Plan):** The task is open-ended, has many valid approaches, or depends heavily on user preferences.
→ Use the \`message\` tool to ask 1-2 clarifying questions first. Do NOT batch multiple questions. If you already have enough context, send a numbered plan with key decisions highlighted. Then STOP.

**How to decide:**
- 0-1 tool calls needed, one right answer → Tier 1
- 2-3 tool calls, clear goal → Tier 2
- 4+ tool calls, open-ended, or 2+ user decisions needed → Tier 3
- When uncertain, tier UP (prefer showing a plan)

**Important:** For Tier 2-3, after sending the plan via the \`message\` tool, produce a short text response like "I've sent you a plan to review." and make NO further tool calls. Wait for user confirmation before executing.`;

const PLANNING_INSTRUCTIONS_TIER4 = `## Task Planning Protocol

The user has explicitly requested a plan. You MUST present a plan before taking any action.

Use the \`message\` tool to send the user a numbered plan (3-6 steps). For complex tasks, highlight key decisions the user should weigh in on.

End the plan with: "Reply 'go' to start, or tell me what to change."

After sending the plan, produce a short text response and make NO further tool calls. Wait for user confirmation.`;

const EXECUTION_INSTRUCTIONS = `## Executing Approved Plan

The user has approved the following plan. Execute it step by step.

{{PLAN}}

**Instructions:**
- Work through the steps in order.
- After completing each major step, use the \`message\` tool to send a brief progress update: "Step N done: [brief result]. Moving to step N+1..."
- If you discover something unexpected that changes the approach for the CURRENT step, adapt and notify: "Heads up: [what changed] so I [what you did instead]."
- If you discover something that changes the OVERALL plan (affects multiple remaining steps), use the \`message\` tool to pause and present options to the user. Then STOP and wait.
- Do NOT silently skip steps or change the approach without notifying the user.`;

const PLAN_MODIFICATION_INSTRUCTIONS = `## Plan Modification

The user was shown this plan:

{{PLAN}}

They responded with this feedback:

{{FEEDBACK}}

Update the plan based on their feedback. Send the revised plan using the \`message\` tool with the same numbered format. End with "Reply 'go' to start, or tell me what to change."

After sending the revised plan, produce a short text response and make NO further tool calls.`;

