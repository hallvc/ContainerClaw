import { loadConfig } from "../../config/loader.ts";
import { resolveModel } from "../../config/models.ts";
import { MessageBus } from "../../bus/queue.ts";
import { OpenRouterClient } from "../../providers/openrouter_client.ts";
import { OpenRouterProvider } from "../../providers/openrouter.ts";
import { AgentLoop } from "../../agent/loop.ts";
import { SlackChannel } from "../../channels/slack.ts";
import { EmailChannel } from "../../channels/email.ts";
import { TelegramChannel } from "../../channels/telegram.ts";
import { ChannelManager } from "../../channels/manager.ts";
import { transcribe } from "../../providers/transcription.ts";
import { CronService } from "../../cron/service.ts";
import { HeartbeatService } from "../../heartbeat/service.ts";
import type { Config } from "../../config/schema.ts";
import { analyzeHealth } from "../../workspace/health.ts";
import { getDirectQuestion } from "../../workspace/questions.ts";

export interface ChannelDetection {
  hasSlack: boolean;
  hasEmail: boolean;
  hasTelegram: boolean;
  hasAny: boolean;
}

export function detectChannels(config: Config): ChannelDetection {
  const hasSlack = !!(config.slack.bot_token && config.slack.app_token);
  const hasEmail = !!config.email.api_key;
  const hasTelegram = !!config.telegram.bot_token;
  return {
    hasSlack,
    hasEmail,
    hasTelegram,
    hasAny: hasSlack || hasEmail || hasTelegram,
  };
}

export async function runGateway(): Promise<void> {
  console.log("containerclaw starting...");

  const config = await loadConfig();

  if (!config.openrouter.api_key) {
    console.error("OPENROUTER_API_KEY is required");
    Deno.exit(1);
  }

  const channels = detectChannels(config);

  if (!channels.hasAny) {
    console.error(
      "At least one channel must be configured (Slack, Email, or Telegram)",
    );
    Deno.exit(1);
  }

  // Create core components
  const bus = new MessageBus();
  const orClient = new OpenRouterClient(config.openrouter.api_key);
  const provider = new OpenRouterProvider(
    orClient,
    config.openrouter.default_model,
  );
  const cron = new CronService(config.data_dir, {
    tickIntervalMs: config.cron.tick_interval_ms,
    jobTimeoutMs: config.cron.job_timeout_ms,
  });
  const agent = new AgentLoop(bus, provider, config, cron);

  const channelManager = new ChannelManager(bus);

  if (channels.hasSlack) {
    const slackChannel = new SlackChannel(
      {
        botToken: config.slack.bot_token,
        appToken: config.slack.app_token,
        groupPolicy: config.slack.group_policy,
        groupAllowFrom: config.slack.group_allow_from,
        dm: {
          enabled: config.slack.dm.enabled,
          policy: config.slack.dm.policy,
          allowFrom: config.slack.dm.allow_from,
        },
      },
      bus,
    );
    channelManager.addChannel(slackChannel);
  }

  if (channels.hasEmail) {
    const emailChannel = new EmailChannel(
      {
        apiKey: config.email.api_key,
        inboxId: config.email.inbox_id,
        username: config.email.username,
        domain: config.email.domain,
        pollIntervalSeconds: config.email.poll_interval_seconds,
        policy: config.email.policy,
        allowFrom: config.email.allow_from,
        dataDir: config.data_dir,
      },
      bus,
    );
    channelManager.addChannel(emailChannel);
  }

  if (channels.hasTelegram) {
    const transcriber = config.openrouter.api_key
      ? (url: string) => transcribe(url, orClient)
      : undefined;
    const telegramChannel = new TelegramChannel(
      config.telegram,
      bus,
      transcriber,
    );
    channelManager.addChannel(telegramChannel);
  }

  // Configure cron callback
  cron.setCallback(async (job) => {
    console.log(`Cron executing: ${job.name}`);
    try {
      let content: string;
      if (job.mode === "task") {
        // Task mode: run through the agent loop for execution
        content = await agent.processDirect(
          job.channel,
          job.chatId,
          job.command,
        );
      } else {
        // Reminder mode (default): send message directly, no LLM
        content = job.command;
      }
      await bus.publishOutbound({
        channel: job.channel,
        chatId: job.chatId,
        content,
        media: [],
        metadata: {},
      });
    } catch (err) {
      console.error(`Cron job execution error: ${err}`);
    }
  });

  // Create heartbeat service
  const heartbeat = new HeartbeatService(
    config.workspace,
    config.heartbeat.interval_seconds,
    config.heartbeat.enabled,
  );
  heartbeat.setCallback(async (prompt) => {
    console.log("Heartbeat executing...");

    // Weekly synthesis: run once per week (check every heartbeat)
    try {
      const lastSynthesisPath = `${config.data_dir}/.last-weekly-synthesis`;
      let shouldSynthesize = false;
      let sinceDate: Date | undefined;
      try {
        const lastRun = await Deno.readTextFile(lastSynthesisPath);
        const lastRunDate = new Date(lastRun.trim());
        const daysSince = (Date.now() - lastRunDate.getTime()) /
          (1000 * 60 * 60 * 24);
        shouldSynthesize = daysSince >= 7;
        if (shouldSynthesize) {
          sinceDate = lastRunDate;
        }
      } catch {
        shouldSynthesize = true; // No record = never run; sinceDate stays undefined (read all)
      }
      if (shouldSynthesize) {
        console.log("Running weekly memory synthesis...");
        await agent.synthesizeWeekly(sinceDate);
        await Deno.writeTextFile(lastSynthesisPath, new Date().toISOString());
      }
    } catch (err) {
      console.error("Weekly synthesis check error:", err);
    }

    // Workspace health: proactive daily nudge if no piggyback happened today
    if (config.workspace_health?.enabled !== false && config.workspace_health?.proactive_nudge !== false) {
      try {
        const healthState = agent.getHealthState();
        const defaultsDir = agent.getDefaultsDir();
        const health = await analyzeHealth(config.workspace, defaultsDir);
        const allGaps = health.files.flatMap((f) => f.gaps);

        if (healthState.needsProactiveNudge(!health.isComplete)) {
          const nextGap = healthState.getNextQuestion(allGaps);
          if (nextGap && healthState.lastActiveChannel && healthState.lastActiveChatId) {
            const question = getDirectQuestion(nextGap.fieldKey);
            await bus.publishOutbound({
              channel: healthState.lastActiveChannel,
              chatId: healthState.lastActiveChatId,
              content: question,
              media: [],
              metadata: {},
            });
            healthState.recordQuestion(nextGap.fieldKey);
            healthState.recordProactiveNudge();
            await healthState.save();
            console.log(`Workspace health: proactive nudge sent for ${nextGap.fieldKey}`);
          }
        }
      } catch (err) {
        console.error("Workspace health proactive nudge error:", err);
      }
    }

    const response = await agent.processDirect("heartbeat", "system", prompt);
    return response;
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    agent.stop();
    cron.stop();
    heartbeat.stop();
    bus.stop();
    await agent.closeMcp();
    await channelManager.stopAll();
    console.log("Shutdown complete");
    Deno.exit(0);
  };

  let shuttingDown = false;
  Deno.addSignalListener("SIGINT", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown().catch((err) => {
      console.error("Shutdown error:", err);
      Deno.exit(1);
    });
  });
  Deno.addSignalListener("SIGTERM", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown().catch((err) => {
      console.error("Shutdown error:", err);
      Deno.exit(1);
    });
  });

  console.log(`Model (chat): ${resolveModel(config, "chat")}`);
  console.log(`Model (memory): ${resolveModel(config, "memory")}`);
  console.log(`Workspace: ${config.workspace}`);
  console.log(`Data dir: ${config.data_dir}`);

  // Start all services concurrently
  console.log("Starting services...");
  await Promise.all([
    agent.run(),
    channelManager.startAll(),
    cron.run(),
    heartbeat.run(),
    bus.dispatchOutbound(),
  ]);
}
