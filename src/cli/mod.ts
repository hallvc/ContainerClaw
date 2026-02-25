import { parseArgs } from "@std/cli/parse-args";

export type ParsedCommand =
  | { command: "gateway" }
  | { command: "agent"; options: { message?: string; session?: string } }
  | { command: "status" }
  | { command: "onboard" }
  | { command: "mcp-add"; options: { url?: string; name?: string; token?: string; auth?: string } };

const VALID_COMMANDS = [
  "gateway",
  "agent",
  "status",
  "onboard",
  "mcp-add",
] as const;
type CommandName = typeof VALID_COMMANDS[number];

const HELP_TEXT = `containerclaw - AI agent framework

Usage: containerclaw [command] [options]

Commands:
  gateway     Start gateway for channels (default)
  agent       Interactive chat mode
  status      Show configuration status
  onboard     Initialize configuration
  mcp-add     Add a remote MCP server

Agent options:
  -m, --message <msg>     Send a single message and exit
  -s, --session <id>      Session ID (default: cli:repl)

MCP-add options:
  --url <url>             Server URL
  --name <name>           Server name
  --token <token>         Bearer token for authentication
  --auth <type>           Auth type: oauth or token

General options:
  -h, --help              Show this help message
`;

export function parseCliArgs(args: string[]): ParsedCommand | null {
  const parsed = parseArgs(args, {
    string: ["message", "session", "url", "name", "token", "auth"],
    boolean: ["help"],
    alias: { m: "message", s: "session", h: "help" },
  });

  if (parsed.help) {
    console.log(HELP_TEXT);
    return null;
  }

  const command = (parsed._[0] as string) ?? "gateway";

  if (!VALID_COMMANDS.includes(command as CommandName)) {
    console.error(`Unknown command: ${command}`);
    console.error("Run with --help for usage information.");
    return null;
  }

  if (command === "agent") {
    const options: { message?: string; session?: string } = {};
    if (parsed.message) options.message = parsed.message;
    if (parsed.session) options.session = parsed.session;
    return { command: "agent", options };
  }

  if (command === "mcp-add") {
    const options: { url?: string; name?: string; token?: string; auth?: string } = {};
    if (parsed.url) options.url = parsed.url;
    if (parsed.name) options.name = parsed.name;
    if (parsed.token) options.token = parsed.token;
    if (parsed.auth) options.auth = parsed.auth;
    return { command: "mcp-add", options };
  }

  return { command: command as "gateway" | "status" | "onboard" };
}

export async function main(): Promise<void> {
  const parsed = parseCliArgs(Deno.args);
  if (!parsed) Deno.exit(0);

  switch (parsed.command) {
    case "gateway": {
      const { runGateway } = await import("./commands/gateway.ts");
      await runGateway();
      break;
    }
    case "agent": {
      const { runAgent } = await import("./commands/agent.ts");
      await runAgent(parsed.options);
      break;
    }
    case "status": {
      const { runStatus } = await import("./commands/status.ts");
      await runStatus();
      break;
    }
    case "onboard": {
      const { runOnboard } = await import("./commands/onboard.ts");
      await runOnboard();
      break;
    }
    case "mcp-add": {
      const { runMcpAdd } = await import("./commands/mcp_add.ts");
      await runMcpAdd(parsed.options);
      break;
    }
  }
}
