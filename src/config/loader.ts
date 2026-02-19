import { dirname, join } from "@std/path";
import { type Config, ConfigSchema } from "./schema.ts";
import { loadDotenv } from "./dotenv.ts";

function parseOptionalFloat(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

function parseOptionalInt(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

function parseOptionalBool(val: string | undefined): boolean | undefined {
  if (val === undefined) return undefined;
  if (val.toLowerCase() === "true") return true;
  if (val.toLowerCase() === "false") return false;
  return undefined;
}

async function readFileConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function defined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

export function buildRawConfig(
  env: Record<string, string | undefined>,
  fileConfig: Record<string, unknown>,
): Record<string, unknown> {
  const model = env.CONTAINERCLAW_MODEL;
  return {
    workspace: env.CONTAINERCLAW_WORKSPACE ??
      (fileConfig.workspace as string | undefined),
    data_dir: env.CONTAINERCLAW_DATA_DIR ??
      (fileConfig.data_dir as string | undefined),
    slack: {
      ...((fileConfig.slack as Record<string, unknown>) ?? {}),
      ...defined({
        bot_token: env.SLACK_BOT_TOKEN,
        app_token: env.SLACK_APP_TOKEN,
        group_policy: env.SLACK_GROUP_POLICY,
      }),
    },
    openrouter: {
      ...((fileConfig.openrouter as Record<string, unknown>) ?? {}),
      ...defined({
        api_key: env.OPENROUTER_API_KEY,
        default_model: model,
      }),
    },
    agents: {
      ...((fileConfig.agents as Record<string, unknown>) ?? {}),
      models: {
        ...(((fileConfig.agents as Record<string, unknown>)?.models as Record<string, unknown>) ?? {}),
        ...defined({
          default: model,
          chat: env.CONTAINERCLAW_MODEL_CHAT,
          memory: env.CONTAINERCLAW_MODEL_MEMORY,
        }),
      },
      ...defined({
        temperature: parseOptionalFloat(env.CONTAINERCLAW_TEMPERATURE),
        max_tokens: parseOptionalInt(env.CONTAINERCLAW_MAX_TOKENS),
        memory_window: parseOptionalInt(env.CONTAINERCLAW_MEMORY_WINDOW),
        consolidation_threshold: parseOptionalInt(env.CONTAINERCLAW_CONSOLIDATION_THRESHOLD),
        max_iterations: parseOptionalInt(env.CONTAINERCLAW_MAX_ITERATIONS),
      }),
    },
    email: {
      ...((fileConfig.email as Record<string, unknown>) ?? {}),
      ...defined({
        api_key: env.AGENTMAIL_API_KEY,
        inbox_id: env.AGENTMAIL_INBOX_ID,
        username: env.AGENTMAIL_USERNAME,
        domain: env.AGENTMAIL_DOMAIN,
        poll_interval_seconds: parseOptionalInt(env.AGENTMAIL_POLL_INTERVAL),
        policy: env.AGENTMAIL_POLICY,
      }),
    },
    telegram: {
      ...((fileConfig.telegram as Record<string, unknown>) ?? {}),
      ...defined({
        bot_token: env.TELEGRAM_BOT_TOKEN,
        allow_from: env.TELEGRAM_ALLOW_FROM
          ? env.TELEGRAM_ALLOW_FROM.split(",").filter(Boolean)
          : undefined,
      }),
    },
    heartbeat: {
      ...((fileConfig.heartbeat as Record<string, unknown>) ?? {}),
      ...defined({
        enabled: parseOptionalBool(env.CONTAINERCLAW_HEARTBEAT_ENABLED),
        interval_seconds: parseOptionalInt(env.CONTAINERCLAW_HEARTBEAT_INTERVAL),
      }),
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveConfigPath(
  explicitPath?: string,
): Promise<string> {
  if (explicitPath) return explicitPath;

  const envPath = Deno.env.get("CONTAINERCLAW_CONFIG_PATH");
  if (envPath) return envPath;

  const candidates = [
    "/data/config.json",
    join(Deno.env.get("HOME") ?? "", ".containerclaw", "config.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  // Default to /data/config.json (Docker default) even if it doesn't exist
  return "/data/config.json";
}

export async function loadConfig(configPath?: string): Promise<Config> {
  const resolvedPath = await resolveConfigPath(configPath);
  await loadDotenv(dirname(resolvedPath));
  const fileConfig = await readFileConfig(resolvedPath);
  const env: Record<string, string | undefined> = {
    CONTAINERCLAW_MODEL: Deno.env.get("CONTAINERCLAW_MODEL"),
    CONTAINERCLAW_MODEL_CHAT: Deno.env.get("CONTAINERCLAW_MODEL_CHAT"),
    CONTAINERCLAW_MODEL_MEMORY: Deno.env.get("CONTAINERCLAW_MODEL_MEMORY"),
    CONTAINERCLAW_WORKSPACE: Deno.env.get("CONTAINERCLAW_WORKSPACE"),
    CONTAINERCLAW_DATA_DIR: Deno.env.get("CONTAINERCLAW_DATA_DIR"),
    CONTAINERCLAW_TEMPERATURE: Deno.env.get("CONTAINERCLAW_TEMPERATURE"),
    CONTAINERCLAW_MAX_TOKENS: Deno.env.get("CONTAINERCLAW_MAX_TOKENS"),
    CONTAINERCLAW_MEMORY_WINDOW: Deno.env.get("CONTAINERCLAW_MEMORY_WINDOW"),
    CONTAINERCLAW_CONSOLIDATION_THRESHOLD: Deno.env.get("CONTAINERCLAW_CONSOLIDATION_THRESHOLD"),
    CONTAINERCLAW_MAX_ITERATIONS: Deno.env.get("CONTAINERCLAW_MAX_ITERATIONS"),
    SLACK_BOT_TOKEN: Deno.env.get("SLACK_BOT_TOKEN"),
    SLACK_APP_TOKEN: Deno.env.get("SLACK_APP_TOKEN"),
    SLACK_GROUP_POLICY: Deno.env.get("SLACK_GROUP_POLICY"),
    OPENROUTER_API_KEY: Deno.env.get("OPENROUTER_API_KEY"),
    TELEGRAM_BOT_TOKEN: Deno.env.get("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_ALLOW_FROM: Deno.env.get("TELEGRAM_ALLOW_FROM"),
    AGENTMAIL_API_KEY: Deno.env.get("AGENTMAIL_API_KEY"),
    AGENTMAIL_INBOX_ID: Deno.env.get("AGENTMAIL_INBOX_ID"),
    AGENTMAIL_USERNAME: Deno.env.get("AGENTMAIL_USERNAME"),
    AGENTMAIL_DOMAIN: Deno.env.get("AGENTMAIL_DOMAIN"),
    AGENTMAIL_POLL_INTERVAL: Deno.env.get("AGENTMAIL_POLL_INTERVAL"),
    AGENTMAIL_POLICY: Deno.env.get("AGENTMAIL_POLICY"),
    CONTAINERCLAW_HEARTBEAT_ENABLED: Deno.env.get("CONTAINERCLAW_HEARTBEAT_ENABLED"),
    CONTAINERCLAW_HEARTBEAT_INTERVAL: Deno.env.get("CONTAINERCLAW_HEARTBEAT_INTERVAL"),
  };
  const raw = buildRawConfig(env, fileConfig);
  const clean = JSON.parse(JSON.stringify(raw));
  return ConfigSchema.parse(clean);
}
