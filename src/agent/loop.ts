import type { MessageBus } from "../bus/queue.ts";
import type { InboundMessage } from "../bus/events.ts";
import { getSessionKey } from "../bus/events.ts";
import type { LLMProvider } from "../providers/base.ts";
import { ToolRegistry } from "./tools/base.ts";
import { ReadFileTool, WriteFileTool, EditFileTool, ListDirTool } from "./tools/filesystem.ts";
import { ExecTool } from "./tools/shell.ts";
import { WebSearchTool, WebFetchTool } from "./tools/web.ts";
import { MessageTool } from "./tools/message.ts";
import { CronTool } from "./tools/cron.ts";
import { connectMcpServers, loadMcpConfig } from "./tools/mcp.ts";
import type { CronService } from "../cron/service.ts";
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

    if (this.cronService) {
      this.tools.register(new CronTool(this.cronService));
    }

    if (this.config.web_search.brave_api_key) {
      this.tools.register(new WebSearchTool(this.config.web_search.brave_api_key));
    }
    this.tools.register(new WebFetchTool());
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
  }

  async run(): Promise<void> {
    this._running = true;
    await this.skills.seedDefaultSkills().catch((e) =>
      console.error("Skill seeding error:", e)
    );
    await this.connectMcp();
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

    // Append to history log
    await this.memory.appendHistory(`[${msg.channel}:${msg.chatId}] User: ${msg.content}`);
    await this.memory.appendHistory(`[${msg.channel}:${msg.chatId}] Assistant: ${response.slice(0, 200)}`);

    // Check if consolidation is needed
    const messageCount = session.messages.length;
    const sinceConsolidation = messageCount - session.lastConsolidated;
    if (sinceConsolidation >= this.config.agents.memory_window) {
      await this.consolidateMemory(session, sessionKey);
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

  private async consolidateMemory(
    session: Session,
    sessionKey: string,
  ): Promise<void> {
    try {
      const existingMemory = await this.memory.readLongTerm();
      const recentMessages = session.messages
        .slice(session.lastConsolidated)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const consolidationPrompt = `You are a memory consolidation assistant. Given the existing long-term memory and recent conversation, update the memory with any important facts, preferences, or context worth remembering.

## Existing Memory
${existingMemory || "(empty)"}

## Recent Conversation
${recentMessages}

## Instructions
Write an updated MEMORY.md that preserves important existing facts and adds any new ones from the recent conversation. Be concise — only store facts worth remembering long-term. Output ONLY the memory content, no explanation.`;

      const response = await this.provider.chat({
        messages: [{ role: "user", content: consolidationPrompt }],
        model: resolveModel(this.config, "memory"),
        maxTokens: 2000,
        temperature: 0.3,
      });

      if (response.content && response.finishReason !== "error") {
        await this.memory.writeLongTerm(response.content);
        session.lastConsolidated = session.messages.length;
        // Re-save session with updated consolidation checkpoint
        this.sessions.save(this.sessions.getOrCreate(sessionKey));
      }
    } catch (err) {
      console.error("Memory consolidation error:", err);
    }
  }

  /**
   * Process a message directly (for cron jobs / internal use).
   */
  async processDirect(
    channel: string,
    chatId: string,
    content: string,
  ): Promise<string> {
    await this.connectMcp();
    const context = new ContextBuilder(this.config.workspace, this.memory, this.skills);
    const messages = await context.buildMessages([], content, []);
    return await this.runAgentLoop(context, messages);
  }
}
