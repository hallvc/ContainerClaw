import { loadConfig } from "../../config/loader.ts";
import { resolveModel } from "../../config/models.ts";
import { MessageBus } from "../../bus/queue.ts";
import { OpenRouterProvider } from "../../providers/openrouter.ts";
import { AgentLoop } from "../../agent/loop.ts";
import { CronService } from "../../cron/service.ts";

export interface AgentOptions {
  message?: string;
  session?: string;
}

export type InputAction =
  | { action: "quit" }
  | { action: "skip" }
  | { action: "help"; text: string }
  | { action: "clear" }
  | { action: "message"; content: string };

const HELP_TEXT = `Commands:
  /new     Clear current session
  /help    Show this help message
  /quit    Exit the REPL
  /exit    Exit the REPL
  :q       Exit the REPL
`;

const QUIT_COMMANDS = new Set(["/quit", "/exit", "exit", "quit", ":q"]);

export function processInput(input: string | null): InputAction {
  if (input === null) return { action: "quit" };

  const trimmed = input.trim();
  if (trimmed === "") return { action: "skip" };

  const lower = trimmed.toLowerCase();

  if (QUIT_COMMANDS.has(lower)) return { action: "quit" };
  if (lower === "/help") return { action: "help", text: HELP_TEXT };
  if (lower === "/new") return { action: "clear" };

  return { action: "message", content: trimmed };
}

export async function runAgent(options: AgentOptions = {}): Promise<void> {
  const config = await loadConfig();

  if (!config.openrouter.api_key) {
    console.error(
      "OPENROUTER_API_KEY is required. Run 'containerclaw onboard' to configure.",
    );
    Deno.exit(1);
  }

  // Create minimal service stack — no channels, no heartbeat
  const bus = new MessageBus();
  const provider = new OpenRouterProvider(
    config.openrouter.api_key,
    config.openrouter.default_model,
  );
  const cron = new CronService(config.data_dir, {
    tickIntervalMs: config.cron.tick_interval_ms,
    jobTimeoutMs: config.cron.job_timeout_ms,
  });
  const agent = new AgentLoop(bus, provider, config, cron);

  const sessionKey = options.session ?? "cli:repl";

  // Single message mode
  if (options.message) {
    try {
      const response = await agent.processDirect("cli", sessionKey, options.message);
      console.log(response);
    } finally {
      await agent.closeMcp();
    }
    return;
  }

  // Interactive REPL mode
  console.log(`containerclaw agent (model: ${resolveModel(config, "chat")})`);
  console.log(`Session: ${sessionKey}`);
  console.log("Type /help for commands, /quit to exit\n");

  while (true) {
    const input = prompt("you> ");
    const action = processInput(input);

    switch (action.action) {
      case "quit":
        await agent.closeMcp();
        console.log("Goodbye!");
        return;

      case "skip":
        continue;

      case "help":
        console.log(action.text);
        continue;

      case "clear":
        console.log("Session cleared.\n");
        continue;

      case "message": {
        try {
          const response = await agent.processDirect(
            "cli",
            sessionKey,
            action.content,
          );
          console.log(`\n${response}\n`);
        } catch (err) {
          console.error(`Error: ${err}`);
        }
        continue;
      }
    }
  }
}
