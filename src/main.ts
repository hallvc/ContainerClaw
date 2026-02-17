import { loadConfig } from "./config/loader.ts";
import { resolveModel } from "./config/models.ts";
import { MessageBus } from "./bus/queue.ts";
import { OpenRouterProvider } from "./providers/openrouter.ts";
import { AgentLoop } from "./agent/loop.ts";
import { SlackChannel } from "./channels/slack.ts";
import { EmailChannel } from "./channels/email.ts";
import { TelegramChannel } from "./channels/telegram.ts";
import { ChannelManager } from "./channels/manager.ts";
import { CronService } from "./cron/service.ts";

async function main(): Promise<void> {
  console.log("nanobot starting...");

  // Load configuration
  const config = await loadConfig();

  // Validate required config
  if (!config.openrouter.api_key) {
    console.error("OPENROUTER_API_KEY is required");
    Deno.exit(1);
  }
  // Validate at least one channel is configured
  const hasSlack = !!(config.slack.bot_token && config.slack.app_token);
  const hasEmail = !!config.email.api_key;
  const hasTelegram = !!config.telegram.bot_token;

  if (!hasSlack && !hasEmail && !hasTelegram) {
    console.error(
      "At least one channel must be configured (Slack, Email, or Telegram)",
    );
    Deno.exit(1);
  }

  // Create core components
  const bus = new MessageBus();
  const provider = new OpenRouterProvider(
    config.openrouter.api_key,
    config.openrouter.default_model,
  );
  const agent = new AgentLoop(bus, provider, config);

  const channelManager = new ChannelManager(bus);

  if (hasSlack) {
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

  if (hasEmail) {
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

  if (hasTelegram) {
    const telegramChannel = new TelegramChannel(config.telegram, bus);
    channelManager.addChannel(telegramChannel);
  }

  // Create cron service
  const cron = new CronService(config.data_dir);
  cron.setCallback(async (job) => {
    console.log(`Cron executing: ${job.name}`);
    try {
      const response = await agent.processDirect(
        job.channel,
        job.chatId,
        job.command,
      );
      await bus.publishOutbound({
        channel: job.channel,
        chatId: job.chatId,
        content: response,
        media: [],
        metadata: {},
      });
    } catch (err) {
      console.error(`Cron job execution error: ${err}`);
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    agent.stop();
    cron.stop();
    bus.stop();
    await channelManager.stopAll();
    console.log("Shutdown complete");
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", () => {
    shutdown();
  });
  Deno.addSignalListener("SIGTERM", () => {
    shutdown();
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
    bus.dispatchOutbound(),
  ]);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  Deno.exit(1);
});
