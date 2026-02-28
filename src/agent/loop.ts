import { join } from "@std/path";
import type { MessageBus } from "../bus/queue.ts";
import type { InboundMessage } from "../bus/events.ts";
import { getSessionKey } from "../bus/events.ts";
import type { LLMProvider } from "../providers/base.ts";
import { isContextAware, ToolRegistry } from "./tools/base.ts";
import {
  EditFileTool,
  ListDirTool,
  ReadFileTool,
  WriteFileTool,
} from "./tools/filesystem.ts";
import { ExecTool } from "./tools/shell.ts";
import { WebFetchTool } from "./tools/web.ts";
import { MessageTool } from "./tools/message.ts";
import { CronTool } from "./tools/cron.ts";
import { SpawnTool } from "./tools/spawn.ts";
import { LearnTool } from "./tools/learn.ts";
import { connectMcpServers, loadMcpConfig } from "./tools/mcp.ts";
import type { MCPAuthPending } from "./tools/mcp.ts";
import { UploadFileTool } from "./tools/upload.ts";
import { ImageGenTool } from "./tools/image_gen.ts";
import { TtsTool } from "./tools/tts.ts";
import { OpenRouterClient } from "../providers/openrouter_client.ts";
import { StorageClient } from "../storage/s3.ts";
import type { Storage } from "../storage/base.ts";
import { ContainerclawOAuthProvider, openBrowser } from "./tools/mcp_auth.ts";
import type { CronService } from "../cron/service.ts";
import { SubagentManager } from "./subagent.ts";
import { SessionManager } from "../session/manager.ts";
import type { Session } from "../session/manager.ts";
import { MemoryStore } from "./memory.ts";
import { seedWorkspace, SkillsLoader } from "./skills.ts";
import { ContextBuilder } from "./context.ts";
import type { Config, ModelRole } from "../config/schema.ts";
import { resolveModel } from "../config/models.ts";
import type { MessageContent } from "../providers/content.ts";
import { detectMediaType } from "../providers/media.ts";
import {
  type PlanState,
  isPlanConfirmation,
  isPlanRejection,
  isPlanRequest,
  createPlanState,
} from "./planning.ts";
import { analyzeHealth } from "../workspace/health.ts";
import { HealthStateManager } from "../workspace/health_state.ts";
import { getSystemHint } from "../workspace/questions.ts";
import { WorkspaceHealthTool } from "./tools/workspace_health.ts";

interface AgentLoopResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    iterations: number;
  };
}

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
  private _mcpAuthErrors: MCPAuthPending[] = [];
  private storage?: Storage;
  private healthState: HealthStateManager;
  private defaultsDir: string;

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

    const whConfig = config.workspace_health ?? { enabled: true, max_questions_per_day: 2, proactive_nudge: true, skip_cooldown_hours: 24 };
    this.healthState = new HealthStateManager(
      config.data_dir,
      whConfig.max_questions_per_day,
      whConfig.skip_cooldown_hours,
    );
    this.defaultsDir = join(import.meta.dirname!, "..", "..", "defaults", "workspace");

    this.registerTools();
  }

  private registerTools(): void {
    const workspace = this.config.workspace;

    this.tools.register(new ReadFileTool(workspace));
    this.tools.register(new WriteFileTool(workspace));
    this.tools.register(new EditFileTool(workspace));
    this.tools.register(new ListDirTool(workspace));
    this.tools.register(
      new ExecTool(workspace, this.config.tools.exec_timeout_ms),
    );
    this.tools.register(
      new MessageTool((msg) => this.bus.publishOutbound(msg)),
    );
    this.tools.register(new SpawnTool(this.subagents));

    if (this.cronService) {
      this.tools.register(new CronTool(this.cronService));
    }

    this.tools.register(new WebFetchTool());
    this.tools.register(new LearnTool(this.memory));

    if (this.config.workspace_health?.enabled !== false) {
      this.tools.register(new WorkspaceHealthTool(
        this.config.workspace,
        this.defaultsDir,
        this.healthState,
      ));
    }
  }

  private async connectMcp(): Promise<void> {
    if (this._mcpConnected) return;
    try {
      const mcpServers = await loadMcpConfig(this.config.workspace);
      if (Object.keys(mcpServers).length === 0) {
        this._mcpConnected = true;
        return;
      }

      // Build OAuth providers for ALL URL-based servers (not just ones with existing tokens).
      // This lets the SDK handle first-time OAuth discovery and authorization automatically.
      // Servers with static Bearer token headers don't need OAuth.
      const authProviders: Record<string, ContainerclawOAuthProvider> = {};
      for (const [name, cfg] of Object.entries(mcpServers)) {
        if (cfg.url && !cfg.headers?.Authorization) {
          authProviders[name] = new ContainerclawOAuthProvider(
            name,
            this.config.workspace,
            cfg,
            (url) => {
              console.log(
                `\nMCP server '${name}': authorization required.`,
              );
              console.log(`  Visit: ${url}`);
              const opened = openBrowser(url.toString());
              if (!opened) {
                authProviders[name].browserOpenFailed = true;
              }
            },
          );
        }
      }

      const { cleanups, authErrors } = await connectMcpServers(
        mcpServers,
        this.tools,
        Object.keys(authProviders).length > 0 ? authProviders : undefined,
      );
      this._mcpCleanup = cleanups;
      this._mcpAuthErrors = authErrors;
      this._mcpConnected = true;
    } catch (err) {
      console.error("MCP connection failed:", err);
      // Don't set _mcpConnected so retry is possible
      throw err;
    }
  }

  async closeMcp(): Promise<void> {
    for (const fn of this._mcpCleanup) {
      try {
        await fn();
      } catch { /* ignore cleanup errors */ }
    }
  }

  private setToolContext(channel: string, chatId: string, metadata?: Record<string, unknown>): void {
    for (const name of ["message", "cron", "spawn"]) {
      const tool = this.tools.get(name);
      if (tool && isContextAware(tool)) {
        tool.setContext(channel, chatId, metadata);
      }
    }
  }

  async run(): Promise<void> {
    this._running = true;

    // Seed workspace from defaults (only copies files that don't exist)
    const defaultsDir = join(import.meta.dirname!, "..", "..", "defaults", "workspace");
    await seedWorkspace(defaultsDir, this.config.workspace).catch((e) =>
      console.error("Workspace seeding error:", e)
    );

    await this.skills.seedDefaultSkills().catch((e) =>
      console.error("Skill seeding error:", e)
    );

    // Initialize storage and register storage-dependent tools
    try {
      const sc = this.config.storage;
      const storageClient = new StorageClient({
        endpoint: sc.endpoint,
        region: sc.region,
        bucket: sc.bucket,
        accessKeyId: sc.access_key_id,
        secretAccessKey: sc.secret_access_key,
        publicUrl: sc.public_url,
        forcePathStyle: sc.force_path_style,
        publicUrlIncludesBucket: sc.public_url_includes_bucket,
      });
      await storageClient.ensureBucket();
      this.storage = storageClient;

      const orClient = new OpenRouterClient(this.config.openrouter.api_key);
      this.tools.register(new UploadFileTool(this.config.workspace, this.storage));
      this.tools.register(new ImageGenTool(
        orClient,
        resolveModel(this.config, "image"),
        this.storage,
      ));
      this.tools.register(new TtsTool(
        orClient,
        resolveModel(this.config, "tts"),
        this.storage,
      ));
    } catch (err) {
      console.error("Storage initialization error (media tools disabled):", err);
    }

    await this.connectMcp();

    // Load workspace health state
    await this.healthState.load().catch((e) =>
      console.error("Workspace health state load error:", e)
    );

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

    // Surface pending MCP auth errors to the user (once)
    if (this._mcpAuthErrors.length > 0) {
      const errors = this._mcpAuthErrors;
      this._mcpAuthErrors = [];
      const lines = errors.map((e) => {
        const urlPart = e.authUrl
          ? `\n  Authorize at: ${e.authUrl}`
          : "";
        return `- **${e.serverName}**: authentication required. Run \`containerclaw mcp-add\` to configure.${urlPart}`;
      });
      await this.bus.publishOutbound({
        channel: msg.channel,
        chatId: msg.chatId,
        content:
          `Some MCP servers require authentication and were skipped:\n${lines.join("\n")}\n\nTools from these servers are unavailable until auth is configured.`,
        media: [],
        metadata: msg.metadata,
      });
    }

    this.setToolContext(msg.channel, msg.chatId, msg.metadata);
    const sessionKey = getSessionKey(msg);
    const session = this.sessions.getOrCreate(sessionKey);

    // Handle slash commands
    if (msg.content.trim().toLowerCase() === "/new") {
      // Extract unextracted messages before clearing to avoid data loss
      const unextractedCount = session.messages.length -
        session.lastConsolidated;
      if (unextractedCount >= 3) {
        const source = `${msg.channel}:${msg.chatId}`;
        await this.extractToDaily(session, sessionKey, source);
      }
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
        content:
          "Available commands:\n- `/new` - Clear session and start fresh\n- `/help` - Show this help message\n\nI can also help with file operations, running commands, web searches, and more!",
        media: [],
        metadata: msg.metadata,
      });
      return;
    }

    // Record user message in session
    session.addMessage("user", msg.content);

    // Track channel activity for workspace health proactive nudges
    if (this.config.workspace_health?.enabled !== false) {
      this.healthState.recordChannelActivity(msg.channel, msg.chatId);
    }

    const planState = session.metadata.plan as PlanState | undefined;
    const planningEnabled = this.config.agents.planning?.enabled !== false;

    let response: string;
    try {
      const onProgress = this.config.agents.progress_updates !== false
        ? async (content: string) => {
            await this.bus.publishOutbound({
              channel: msg.channel,
              chatId: msg.chatId,
              content,
              media: [],
              metadata: msg.metadata ?? {},
            });
          }
        : undefined;

      const hasImages = msg.media.some((m) => detectMediaType(m) === "image");
      const modelRole: ModelRole = hasImages ? "vision" : "chat";

      if (planningEnabled && planState?.status === "proposed") {
        // --- User is responding to a proposed plan ---
        if (isPlanConfirmation(msg.content)) {
          // Approved: run execution loop with plan as instructions
          (session.metadata.plan as PlanState).status = "executing";
          this.sessions.save(session);

          const context = new ContextBuilder(this.config.workspace, this.memory, this.skills);
          const history = session.getHistory(this.config.agents.memory_window);
          const pastHistory = history.slice(0, -1);
          const messages = await context.buildMessages(pastHistory, msg.content, msg.media);
          context.addExecutionInstructions(planState.planText);

          const result = await this.runAgentLoop(context, messages, onProgress, modelRole, true);
          response = result.content;

          // Mark plan as completed
          (session.metadata.plan as PlanState).status = "completed";
        } else if (isPlanRejection(msg.content)) {
          // Rejected: clear plan and respond normally
          delete session.metadata.plan;
          this.sessions.save(session);
          response = "No problem, plan discarded. What would you like to do instead?";
        } else {
          // Modification: re-run planning loop with feedback
          const context = new ContextBuilder(this.config.workspace, this.memory, this.skills);
          const history = session.getHistory(this.config.agents.memory_window);
          const pastHistory = history.slice(0, -1);
          const messages = await context.buildMessages(pastHistory, msg.content, msg.media);
          context.addPlanModificationInstructions(planState.planText, msg.content);

          const result = await this.runAgentLoop(context, messages, onProgress, modelRole);
          response = result.content;

          // Check if a new plan was sent via the message tool — update plan state
          this.detectAndStorePlan(session, result.content, planState.tier as 2 | 3 | 4);
        }
      } else {
        // --- Normal flow: planning loop or direct execution ---
        const context = new ContextBuilder(this.config.workspace, this.memory, this.skills);
        const history = session.getHistory(this.config.agents.memory_window);
        const pastHistory = history.slice(0, -1);
        const messages = await context.buildMessages(pastHistory, msg.content, msg.media);

        // Thread monitoring: tell LLM it can skip responding
        const slackMeta = msg.metadata?.slack as Record<string, unknown> | undefined;
        const isMonitoredThread = slackMeta?.threadMonitored === true;
        if (isMonitoredThread) {
          context.addUserHint(
            "[System: This message is from a Slack thread you were previously tagged in, but you were NOT directly mentioned in this message. " +
            "Respond ONLY if the message is clearly directed at you (a question, request, or continuing the conversation with you). " +
            "If the message is people talking to each other or doesn't need your input, respond with exactly: [NO_RESPONSE_NEEDED]]"
          );
        }

        // Inject planning instructions if enabled
        if (planningEnabled) {
          const forceTier4 = isPlanRequest(msg.content);
          context.addPlanningInstructions(forceTier4);
        }

        // Workspace health: inject piggyback hint or pending-answer hint
        if (this.config.workspace_health?.enabled !== false) {
          await this.injectHealthHint(context, planState);
        }

        const result = await this.runAgentLoop(context, messages, onProgress, modelRole);
        response = result.content;

        // Detect if the LLM sent a plan via the message tool
        if (planningEnabled) {
          this.detectAndStorePlan(session, result.content);
        }
      }
    } catch (err) {
      console.error("Error in agent processing:", err);
      response = "Sorry, I encountered an unexpected error processing your request.";
    }

    // Check if thread-monitored message should be silently skipped
    const slackMetaOut = msg.metadata?.slack as Record<string, unknown> | undefined;
    const isMonitoredThreadOut = slackMetaOut?.threadMonitored === true;

    if (isMonitoredThreadOut && response.trim() === "[NO_RESPONSE_NEEDED]") {
      // Thread-monitored message not directed at bot — record silently, don't publish
      session.addMessage("assistant", "(no response — not directed at bot)");
      this.sessions.save(session);
      return;
    }

    // Record assistant response and publish FIRST (before housekeeping)
    session.addMessage("assistant", response);
    this.sessions.save(session);

    await this.bus.publishOutbound({
      channel: msg.channel,
      chatId: msg.chatId,
      content: response,
      media: [],
      metadata: msg.metadata,
    });

    // Housekeeping AFTER response delivery
    try {
      const source = `${msg.channel}:${msg.chatId}`;
      const truncatedResponse = response.length > 200
        ? response.slice(0, 200) + "..."
        : response;
      await this.memory.appendHistory(
        `[${source}] User: ${msg.content}\n[${source}] Assistant: ${truncatedResponse}`
      );

      // Check if extraction to daily note is needed (Tier 1 consolidation)
      const messageCount = session.messages.length;
      const sinceConsolidation = messageCount - session.lastConsolidated;
      if (sinceConsolidation >= this.config.agents.consolidation_threshold) {
        await this.extractToDaily(session, sessionKey, source);
      }
    } catch (err) {
      console.error("Housekeeping error (response already delivered):", err);
    }
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

    // Record system message BEFORE building context (matches processMessage pattern)
    session.addMessage("user", `[System: ${msg.senderId}] ${msg.content}`);

    let response: string;
    try {
      const context = new ContextBuilder(
        this.config.workspace,
        this.memory,
        this.skills,
      );
      const history = session.getHistory(this.config.agents.memory_window);
      const pastHistory = history.slice(0, -1);
      const messages = await context.buildMessages(pastHistory, msg.content, []);

      const result = await this.runAgentLoop(context, messages);
      response = result.content;
    } catch (err) {
      console.error("Error in system message processing:", err);
      response = "Sorry, I encountered an unexpected error processing this request.";
    }

    // Record assistant response AFTER (same pattern as processMessage)
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
    messages: Array<
      {
        role: string;
        content: MessageContent;
        tool_calls?: unknown[];
        tool_call_id?: string;
        name?: string;
      }
    >,
    onProgress?: (content: string) => Promise<void>,
    modelRole: ModelRole = "chat",
    planExecuting: boolean = false,
  ): Promise<AgentLoopResult> {
    const maxIterations = this.config.agents.max_iterations;
    const tokenBudget = this.config.agents.token_budget;
    let lastContent = "";
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, iterations: 0 };
    let progressSent = false;

    for (let i = 0; i < maxIterations; i++) {
      if (planExecuting && i > 0 && onProgress) {
        // When executing a plan, inject progress hint on every iteration
        context.addUserHint(
          "[System instruction]: You are executing an approved plan. If you just completed a step, use the `message` tool to report progress before continuing to the next step."
        );
        messages = context.getMessages();
      } else if (i === 1 && onProgress && !progressSent) {
        // Default behavior: after first tool-call iteration, send progress signal
        await onProgress("Working on this — I'll update you as I go.");
        progressSent = true;

        // Inject hint asking LLM to summarize its plan via the message tool
        context.addUserHint(
          "[System instruction]: You are working on a multi-step task. Before continuing, use the `message` tool to send the user a brief summary of your plan (2-3 sentences, what you're going to do and why). Then continue executing."
        );
        messages = context.getMessages();
      }
      // Budget check before next LLM call (skip on first iteration)
      if (tokenBudget && usage.totalTokens >= tokenBudget) {
        console.log(`Token budget exhausted: ${usage.totalTokens}/${tokenBudget}`);
        break;
      }

      // Retry transient LLM errors (timeouts, network) before giving up
      let response;
      for (let llmAttempt = 0; llmAttempt < 3; llmAttempt++) {
        response = await this.provider.chat({
          messages,
          tools: this.tools.getDefinitions(),
          model: resolveModel(this.config, modelRole),
          maxTokens: this.config.agents.max_tokens,
          temperature: this.config.agents.temperature,
        });
        if (response.finishReason !== "error") break;
        // Only retry transient-looking errors
        const errText = response.content ?? "";
        const isTransient = /too long|try again|trouble connecting|temporary/i.test(errText);
        if (!isTransient || llmAttempt >= 2) {
          console.error(`LLM error (non-retryable or retries exhausted): ${errText}`);
          return { content: errText || "Sorry, I encountered an error processing your request.", usage };
        }
        const delay = 5000 * Math.pow(2, llmAttempt); // 5s, 10s
        console.warn(`LLM returned transient error, retrying in ${delay / 1000}s (attempt ${llmAttempt + 1}/3): ${errText}`);
        await new Promise((r) => setTimeout(r, delay));
      }

      // Accumulate token usage
      usage.promptTokens += response!.usage.promptTokens ?? 0;
      usage.completionTokens += response!.usage.completionTokens ?? 0;
      usage.totalTokens += response!.usage.totalTokens ?? 0;
      usage.iterations = i + 1;

      if (response.content) {
        lastContent = response.content;
      }

      // No tool calls — we're done
      if (response.toolCalls.length === 0) {
        return { content: lastContent || "I'm not sure how to respond to that.", usage };
      }

      // Add assistant message with tool calls
      context.addAssistantMessage(
        response.content,
        response.toolCalls,
        response.reasoning_content,
      );

      if (response.reasoning_content) {
        console.log(`Reasoning: ${response.reasoning_content.slice(0, 200)}`);
      }

      // Execute tool calls in parallel
      for (const tc of response.toolCalls) {
        console.log(
          `Tool call: ${tc.name}(${
            JSON.stringify(tc.arguments).slice(0, 100)
          })`,
        );
      }
      const toolResults = await this.tools.executeParallel(
        response.toolCalls.map((tc) => ({ name: tc.name, args: tc.arguments })),
      );
      for (let j = 0; j < response.toolCalls.length; j++) {
        context.addToolResult(response.toolCalls[j].id, toolResults[j].name, toolResults[j].result);
      }

      // Update messages for next iteration
      messages = context.getMessages();
    }

    const content = lastContent ||
      "I reached the maximum number of iterations. Here's what I have so far.";
    if (usage.totalTokens > 0) {
      console.log(`Turn usage: ${usage.totalTokens} tokens (${usage.iterations} iterations)`);
    }
    return { content, usage };
  }

  /**
   * Inject workspace health hints into the LLM context.
   * - If a pending question exists, inject answer-detection hint.
   * - Otherwise, if gaps exist and we can ask today, inject a piggyback question hint.
   * - Never injects when a plan is pending (planning collision guard).
   */
  private async injectHealthHint(
    context: ContextBuilder,
    planState?: PlanState,
  ): Promise<void> {
    try {
      // Planning collision guard: never inject when a plan is proposed
      if (planState?.status === "proposed") {
        this.healthState.clearPendingQuestion();
        return;
      }

      const pending = this.healthState.pendingQuestion;
      if (pending) {
        // Answer-detection hint for a previously asked question
        const entry = await import("../workspace/questions.ts");
        const fieldLabel = pending.replace(/\.\w/, (m) => " " + m[1].toUpperCase()).replace(/^\w+\./, "");
        context.addHealthHint(
          `You recently asked the user about their ${fieldLabel}. ` +
          `If their response answers that question, call the \`workspace_health\` tool with action "record_answer", field_key "${pending}", and the extracted value. ` +
          `If they say "skip", "not now", or "later", call the tool with action "record_skip" and field_key "${pending}". ` +
          `If they're asking something completely unrelated, respond normally and ignore the health question — it will be asked again later.`
        );
        void entry; // suppress unused import warning
        return;
      }

      // Check if we can ask a new question
      if (!this.healthState.canAskToday() || this.healthState.piggybackedToday) return;

      const health = await analyzeHealth(this.config.workspace, this.defaultsDir);
      if (health.isComplete) return;

      const allGaps = health.files.flatMap((f) => f.gaps);
      const nextGap = this.healthState.getNextQuestion(allGaps);
      if (!nextGap) return;

      // Inject piggyback hint
      const hint = getSystemHint(nextGap.fieldKey);
      context.addHealthHint(
        `## Workspace Profile\n\n` +
        `You haven't learned some basic information about the user yet. ${hint} ` +
        `When they answer, call the \`workspace_health\` tool with action "record_answer", field_key "${nextGap.fieldKey}", and the extracted value. ` +
        `If they say "skip" or "not now", call it with action "record_skip". ` +
        `Keep it casual and natural — this should feel like a brief aside, not a form.`
      );

      this.healthState.recordQuestion(nextGap.fieldKey);
      this.healthState.recordPiggyback();
      await this.healthState.save();
    } catch (err) {
      console.error("Workspace health hint error:", err);
    }
  }

  /** Expose health state for gateway proactive nudge integration. */
  getHealthState(): HealthStateManager {
    return this.healthState;
  }

  /** Expose defaults directory for gateway proactive nudge. */
  getDefaultsDir(): string {
    return this.defaultsDir;
  }

  /**
   * Detect if the LLM's response indicates it sent a plan to the user via the message tool.
   * If so, store it in session metadata as a proposed plan.
   *
   * Heuristic: if the response text mentions a plan was sent or asks to confirm,
   * and the message tool was likely called (we can infer from the response pattern),
   * treat it as a plan proposal. The actual plan text is what the message tool sent,
   * but since we can't easily intercept that, we look for plan-like patterns in the
   * final response and the session's last outbound message.
   */
  private detectAndStorePlan(
    session: Session,
    responseText: string,
    forceTier?: 2 | 3 | 4,
  ): void {
    // Look for signals that a plan was proposed:
    // - Response mentions waiting for confirmation
    // - Response mentions "plan" + "review"/"approve"/"confirm"
    const planProposalSignals = [
      /reply\s+['"]?go['"]?/i,
      /tell\s+me\s+what\s+to\s+change/i,
      /I['']ve\s+sent\s+(you\s+)?a\s+plan/i,
      /plan\s+to\s+review/i,
      /waiting\s+for\s+(your\s+)?(confirmation|approval)/i,
      /ready\s+to\s+start\?/i,
      /want\s+me\s+to\s+proceed/i,
    ];

    const looksLikePlanResponse = planProposalSignals.some((p) =>
      p.test(responseText)
    );

    if (!looksLikePlanResponse) return;

    // Find the most recent outbound plan text from session messages
    // The message tool would have sent a message — look for the last assistant/tool content
    // that looks like a numbered plan
    let planText = "";
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === "assistant" && m.content) {
        // Check if this message contains a numbered list (plan format)
        const hasNumberedSteps = /^\s*\d+\.\s+/m.test(m.content);
        if (hasNumberedSteps) {
          planText = m.content;
          break;
        }
      }
    }

    // If we couldn't find a plan in session messages, try to extract from outbound
    // messages that were sent via the message tool (they won't be in session history
    // since they go through the bus). In this case, we note that a plan was proposed
    // but can't capture the exact text.
    if (!planText) {
      // Store a minimal plan state so we know to check for confirmation
      planText = "(Plan sent via message — see chat history)";
    }

    const tier = forceTier ?? 2;
    session.metadata.plan = createPlanState(planText, tier as 2 | 3 | 4);
    this.sessions.save(session);
    console.log(`Plan proposed (Tier ${tier}), awaiting user confirmation.`);
  }

  /**
   * Tier 1 consolidation: Extract noteworthy facts from recent conversation
   * into today's daily note. Does NOT rewrite MEMORY.md.
   */
  private async extractToDaily(
    session: Session,
    _sessionKey: string,
    source: string,
  ): Promise<void> {
    try {
      const recentMessages = session.messages
        .slice(session.lastConsolidated)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const extractionPrompt =
        `You are a memory extraction assistant. Extract noteworthy facts, decisions, preferences, and TODOs from this conversation.

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
  async synthesizeWeekly(since?: Date): Promise<void> {
    try {
      const { existingMemory, weeklyNotes } = await this.memory
        .getWeeklySynthesisInput(since);

      if (!weeklyNotes.trim()) {
        console.log("Weekly synthesis: no daily notes to synthesize.");
        return;
      }

      const synthesisPrompt =
        `You are a memory synthesis assistant. Given the past week's daily notes and the current long-term memory, produce an updated MEMORY.md.

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
        // Version existing MEMORY.md before overwriting
        const versionPath = await this.memory.versionMemory();
        if (versionPath) {
          console.log(`Versioned MEMORY.md to ${versionPath}`);
        }
        await this.memory.writeLongTerm(response.content);
        console.log("Weekly synthesis complete — MEMORY.md updated.");
        // Prune old versions (keep 10)
        await this.memory.pruneVersions(10);
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
    const context = new ContextBuilder(
      this.config.workspace,
      this.memory,
      this.skills,
    );
    const messages = await context.buildMessages([], content, []);
    const result = await this.runAgentLoop(context, messages);
    return result.content;
  }
}
