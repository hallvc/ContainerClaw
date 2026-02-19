import type { MessageBus } from "../bus/queue.ts";
import type { InboundMessage } from "../bus/events.ts";
import { getSessionKey } from "../bus/events.ts";
import type { LLMProvider } from "../providers/base.ts";
import { ToolRegistry } from "./tools/base.ts";
import { ReadFileTool, WriteFileTool, EditFileTool, ListDirTool } from "./tools/filesystem.ts";
import { ExecTool } from "./tools/shell.ts";
import { WebFetchTool } from "./tools/web.ts";
import { MessageTool } from "./tools/message.ts";
import { CronTool } from "./tools/cron.ts";
import { SpawnTool } from "./tools/spawn.ts";
import { LearnTool } from "./tools/learn.ts";
import { connectMcpServers, loadMcpConfig } from "./tools/mcp.ts";
import type { CronService } from "../cron/service.ts";
import { SubagentManager } from "./subagent.ts";
import { SessionManager } from "../session/manager.ts";
import type { Session } from "../session/manager.ts";
import { MemoryStore } from "./memory.ts";
import { SkillsLoader } from "./skills.ts";
import { ContextBuilder } from "./context.ts";
import type { Config } from "../config/schema.ts";
import { resolveModel } from "../config/models.ts";

export class AgentLoop {
  private bus: MessageBus;
  private provider: LLMProvider;
  private tools: ToolRegistry;
  private sessions: SessionManager;
  private memory: MemoryStore;
  private skills: SkillsLoader;
  private config: Config;
  private cronService?: CronService;
  private subagents: SubagentManager;
  private _running = false;
  private _mcpConnected = false;
  private _mcpCleanup: Array<() => Promise<void>> = [];

  constructor(
    bus: MessageBus,
    provider: LLMProvider,
    config: Config,
    cronService?: CronService,
  ) {
    this.bus = bus;
    this.provider = provider;
    this.config = config;
    this.cronService = cronService;
    this.sessions = new SessionManager(config.data_dir);
    this.memory = new MemoryStore(config.data_dir);
    this.skills = new SkillsLoader(config.workspace);
    this.tools = new ToolRegistry();
    this.subagents = new SubagentManager(provider, config.workspace, bus, {
      model: resolveModel(config, "chat"),
      temperature: config.agents.temperature,
      maxTokens: config.agents.max_tokens,
      execTimeoutMs: config.tools.exec_timeout_ms,
    });

    this.registerTools();
  }

  private registerTools(): void {
    const workspace = this.config.workspace;

    this.tools.register(new ReadFileTool(workspace));
    this.tools.register(new WriteFileTool(workspace));
    this.tools.register(new EditFileTool(workspace));
    this.tools.register(new ListDirTool(workspace));
    this.tools.register(new ExecTool(workspace, this.config.tools.exec_timeout_ms));
    this.tools.register(new MessageTool((msg) => this.bus.publishOutbound(msg)));
    this.tools.register(new SpawnTool(this.subagents));

    if (this.cronService) {
      this.tools.register(new CronTool(this.cronService));
    }

    this.tools.register(new WebFetchTool());
    this.tools.register(new LearnTool(this.memory));
  }

  private async connectMcp(): Promise<void> {
    if (this._mcpConnected) return;
    this._mcpConnected = true;
    const mcpServers = await loadMcpConfig(this.config.workspace);
    if (Object.keys(mcpServers).length === 0) return;
    this._mcpCleanup = await connectMcpServers(mcpServers, this.tools);
  }

  async closeMcp(): Promise<void> {
    for (const fn of this._mcpCleanup) {
      try { await fn(); } catch { /* ignore cleanup errors */ }
    }
  }

  private setToolContext(channel: string, chatId: string): void {
    const msgTool = this.tools.get("message");
    if (msgTool && "setContext" in msgTool) {
      (msgTool as MessageTool).setContext(channel, chatId);
    }
    const cronTool = this.tools.get("cron");
    if (cronTool && "setContext" in cronTool) {
      (cronTool as CronTool).setContext(channel, chatId);
    }
    const spawnTool = this.tools.get("spawn");
    if (spawnTool && "setContext" in spawnTool) {
      (spawnTool as SpawnTool).setContext(channel, chatId);
    }
  }

  async run(): Promise<void> {
    this._running = true;
    await this.skills.seedDefaultSkills().catch((e) =>
      console.error("Skill seeding error:", e)
    );
    await this.connectMcp();

    // Ensure memory directory structure exists
    await this.memory.ensureDirectories().catch((e) =>
      console.error("Memory directory setup error:", e)
    );

    // Rebuild memory index if stale
    if (await this.memory.isIndexStale().catch(() => true)) {
      await this.memory.rebuildIndex().catch((e) =>
        console.error("Memory index rebuild error:", e)
      );
    }

    console.log("Agent loop started");

    while (this._running) {
      try {
        const msg = await this.bus.consumeInboundWithTimeout(1000);
        if (!msg) continue;

        await this.processMessage(msg);
      } catch (err) {
        console.error("Agent loop error:", err);
      }
    }
  }

  stop(): void {
    this._running = false;
  }

  private async processMessage(msg: InboundMessage): Promise<void> {
    if (msg.channel === "system") {
      return this.processSystemMessage(msg);
    }

    this.setToolContext(msg.channel, msg.chatId);
    const sessionKey = getSessionKey(msg);
    const session = this.sessions.getOrCreate(sessionKey);

    // Handle slash commands
    if (msg.content.trim().toLowerCase() === "/new") {
      session.clear();
      this.sessions.save(session);
      await this.bus.publishOutbound({
        channel: msg.channel,
        chatId: msg.chatId,
        content: "Session cleared. Starting fresh!",
        media: [],
        metadata: msg.metadata,
      });
      return;
    }

    if (msg.content.trim().toLowerCase() === "/help") {
      await this.bus.publishOutbound({
        channel: msg.channel,
        chatId: msg.chatId,
        content: "Available commands:\n- `/new` - Clear session and start fresh\n- `/help` - Show this help message\n\nI can also help with file operations, running commands, web searches, and more!",
        media: [],
        metadata: msg.metadata,
      });
      return;
    }

    // Record user message in session
    session.addMessage("user", msg.content);

    // Build context
    const context = new ContextBuilder(this.config.workspace, this.memory, this.skills);
    const history = session.getHistory(this.config.agents.memory_window);
    // Remove the last message from history since we'll add it as the current message
    const pastHistory = history.slice(0, -1);
    const messages = await context.buildMessages(pastHistory, msg.content, msg.media);

    // Run agent iteration loop
    const response = await this.runAgentLoop(context, messages);

    // Record assistant response
    session.addMessage("assistant", response);
    this.sessions.save(session);

    // Legacy history log (daily notes populated by Tier 1 extraction instead)
    const source = `${msg.channel}:${msg.chatId}`;
    const truncatedResponse = response.length > 200 ? response.slice(0, 200) + "..." : response;
    await this.memory.appendHistory(`[${source}] User: ${msg.content}`);
    await this.memory.appendHistory(`[${source}] Assistant: ${truncatedResponse}`);

    // Check if extraction to daily note is needed (Tier 1 consolidation)
    const messageCount = session.messages.length;
    const sinceConsolidation = messageCount - session.lastConsolidated;
    if (sinceConsolidation >= this.config.agents.consolidation_threshold) {
      await this.extractToDaily(session, sessionKey, source);
    }

    // Publish response
    await this.bus.publishOutbound({
      channel: msg.channel,
      chatId: msg.chatId,
      content: response,
      media: [],
      metadata: msg.metadata,
    });
  }

  private async processSystemMessage(msg: InboundMessage): Promise<void> {
    // Parse origin from chatId format "channel:chatId"
    let originChannel: string;
    let originChatId: string;
    if (msg.chatId.includes(":")) {
      const idx = msg.chatId.indexOf(":");
      originChannel = msg.chatId.slice(0, idx);
      originChatId = msg.chatId.slice(idx + 1);
    } else {
      originChannel = "cli";
      originChatId = msg.chatId;
    }

    const sessionKey = `${originChannel}:${originChatId}`;
    const session = this.sessions.getOrCreate(sessionKey);
    this.setToolContext(originChannel, originChatId);

    const context = new ContextBuilder(this.config.workspace, this.memory, this.skills);
    const history = session.getHistory(this.config.agents.memory_window);
    const messages = await context.buildMessages(history, msg.content, []);

    const response = await this.runAgentLoop(context, messages);

    session.addMessage("user", `[System: ${msg.senderId}] ${msg.content}`);
    session.addMessage("assistant", response);
    this.sessions.save(session);

    await this.bus.publishOutbound({
      channel: originChannel,
      chatId: originChatId,
      content: response,
      media: [],
      metadata: {},
    });
  }

  private async runAgentLoop(
    context: ContextBuilder,
    messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>,
  ): Promise<string> {
    const maxIterations = this.config.agents.max_iterations;
    let lastContent = "";

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.provider.chat({
        messages,
        tools: this.tools.getDefinitions(),
        model: resolveModel(this.config, "chat"),
        maxTokens: this.config.agents.max_tokens,
        temperature: this.config.agents.temperature,
      });

      if (response.finishReason === "error") {
        return response.content ?? "Sorry, I encountered an error processing your request.";
      }

      if (response.content) {
        lastContent = response.content;
      }

      // No tool calls — we're done
      if (response.toolCalls.length === 0) {
        return lastContent || "I'm not sure how to respond to that.";
      }

      // Add assistant message with tool calls
      context.addAssistantMessage(response.content, response.toolCalls, response.reasoning_content);

      if (response.reasoning_content) {
        console.log(`Reasoning: ${response.reasoning_content.slice(0, 200)}`);
      }

      // Execute each tool call
      for (const tc of response.toolCalls) {
        console.log(`Tool call: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`);
        const result = await this.tools.execute(tc.name, tc.arguments);
        context.addToolResult(tc.id, tc.name, result);
      }

      // Update messages for next iteration
      messages = context.getMessages();
    }

    return lastContent || "I reached the maximum number of iterations. Here's what I have so far.";
  }

  /**
   * Tier 1 consolidation: Extract noteworthy facts from recent conversation
   * into today's daily note. Does NOT rewrite MEMORY.md.
   */
  private async extractToDaily(
    session: Session,
    sessionKey: string,
    source: string,
  ): Promise<void> {
    try {
      const recentMessages = session.messages
        .slice(session.lastConsolidated)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const extractionPrompt = `You are a memory extraction assistant. Extract noteworthy facts, decisions, preferences, and TODOs from this conversation.

## Recent Conversation
${recentMessages}

## Instructions
Output a bulleted list of important items worth remembering. Each bullet should be a single clear fact or decision. Include:
- User preferences stated or implied
- Decisions made
- Technical facts learned
- TODOs or action items mentioned
- People, projects, or tools referenced

Be concise. Only include items worth remembering. If nothing noteworthy, output "No new items."
Output ONLY the bullet list, no explanation or headers.`;

      const response = await this.provider.chat({
        messages: [{ role: "user", content: extractionPrompt }],
        model: resolveModel(this.config, "memory"),
        maxTokens: 1000,
        temperature: 0.3,
      });

      if (response.content && response.finishReason !== "error") {
        const content = response.content.trim();
        if (content && !content.toLowerCase().includes("no new items")) {
          await this.memory.appendDailyNote({
            time: new Date().toISOString().split("T")[1].slice(0, 5),
            source,
            title: "Extracted from conversation",
            bullets: content
              .split("\n")
              .map((l) => l.replace(/^[-*]\s*/, "").trim())
              .filter((l) => l),
          });
        }
      }

      session.lastConsolidated = session.messages.length;
      this.sessions.save(session);
    } catch (err) {
      console.error("Memory extraction error:", err);
    }
  }

  /**
   * Tier 2 consolidation: Weekly synthesis of daily notes into MEMORY.md.
   * Called by heartbeat/cron, not on the hot path.
   */
  async synthesizeWeekly(): Promise<void> {
    try {
      const { existingMemory, weeklyNotes } =
        await this.memory.getWeeklySynthesisInput();

      if (!weeklyNotes.trim()) {
        console.log("Weekly synthesis: no daily notes to synthesize.");
        return;
      }

      const synthesisPrompt = `You are a memory synthesis assistant. Given the past week's daily notes and the current long-term memory, produce an updated MEMORY.md.

## Current MEMORY.md
${existingMemory || "(empty)"}

## This Week's Daily Notes
${weeklyNotes}

## Instructions
Write an updated MEMORY.md that:
1. Preserves existing facts that are still relevant
2. Adds new patterns, preferences, and key context from the week
3. Removes outdated or contradicted information
4. Groups information logically (user info, preferences, project context, important notes)
5. Is concise — only include facts worth remembering long-term

Output ONLY the memory content, no explanation.`;

      const response = await this.provider.chat({
        messages: [{ role: "user", content: synthesisPrompt }],
        model: resolveModel(this.config, "memory"),
        maxTokens: 3000,
        temperature: 0.3,
      });

      if (response.content && response.finishReason !== "error") {
        await this.memory.writeLongTerm(response.content);
        console.log("Weekly synthesis complete — MEMORY.md updated.");
      }

      // Archive old daily notes (older than 30 days)
      const archived = await this.memory.archiveOldNotes(30);
      if (archived > 0) {
        console.log(`Archived ${archived} old daily notes.`);
      }
    } catch (err) {
      console.error("Weekly synthesis error:", err);
    }
  }

  /**
   * Process a message directly (for cron jobs / internal use).
   */
  async processDirect(
    _channel: string,
    _chatId: string,
    content: string,
  ): Promise<string> {
    await this.connectMcp();
    const context = new ContextBuilder(this.config.workspace, this.memory, this.skills);
    const messages = await context.buildMessages([], content, []);
    return await this.runAgentLoop(context, messages);
  }
}
