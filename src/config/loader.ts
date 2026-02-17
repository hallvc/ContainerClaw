import { type Config, ConfigSchema } from "./schema.ts";

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
  const model = env.NANOBOT_MODEL;
  return {
    workspace: env.NANOBOT_WORKSPACE ??
      (fileConfig.workspace as string | undefined),
    data_dir: env.NANOBOT_DATA_DIR ??
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
          chat: env.NANOBOT_MODEL_CHAT,
          memory: env.NANOBOT_MODEL_MEMORY,
        }),
      },
      ...defined({
        temperature: parseOptionalFloat(env.NANOBOT_TEMPERATURE),
        max_tokens: parseOptionalInt(env.NANOBOT_MAX_TOKENS),
        memory_window: parseOptionalInt(env.NANOBOT_MEMORY_WINDOW),
        max_iterations: parseOptionalInt(env.NANOBOT_MAX_ITERATIONS),
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
    web_search: {
      ...((fileConfig.web_search as Record<string, unknown>) ?? {}),
      ...defined({
        brave_api_key: env.BRAVE_API_KEY,
      }),
    },
  };
}

export async function loadConfig(): Promise<Config> {
  const fileConfig = await readFileConfig("/data/config.json");
  const env: Record<string, string | undefined> = {
    NANOBOT_MODEL: Deno.env.get("NANOBOT_MODEL"),
    NANOBOT_MODEL_CHAT: Deno.env.get("NANOBOT_MODEL_CHAT"),
    NANOBOT_MODEL_MEMORY: Deno.env.get("NANOBOT_MODEL_MEMORY"),
    NANOBOT_WORKSPACE: Deno.env.get("NANOBOT_WORKSPACE"),
    NANOBOT_DATA_DIR: Deno.env.get("NANOBOT_DATA_DIR"),
    NANOBOT_TEMPERATURE: Deno.env.get("NANOBOT_TEMPERATURE"),
    NANOBOT_MAX_TOKENS: Deno.env.get("NANOBOT_MAX_TOKENS"),
    NANOBOT_MEMORY_WINDOW: Deno.env.get("NANOBOT_MEMORY_WINDOW"),
    NANOBOT_MAX_ITERATIONS: Deno.env.get("NANOBOT_MAX_ITERATIONS"),
    SLACK_BOT_TOKEN: Deno.env.get("SLACK_BOT_TOKEN"),
    SLACK_APP_TOKEN: Deno.env.get("SLACK_APP_TOKEN"),
    SLACK_GROUP_POLICY: Deno.env.get("SLACK_GROUP_POLICY"),
    OPENROUTER_API_KEY: Deno.env.get("OPENROUTER_API_KEY"),
    BRAVE_API_KEY: Deno.env.get("BRAVE_API_KEY"),
    AGENTMAIL_API_KEY: Deno.env.get("AGENTMAIL_API_KEY"),
    AGENTMAIL_INBOX_ID: Deno.env.get("AGENTMAIL_INBOX_ID"),
    AGENTMAIL_USERNAME: Deno.env.get("AGENTMAIL_USERNAME"),
    AGENTMAIL_DOMAIN: Deno.env.get("AGENTMAIL_DOMAIN"),
    AGENTMAIL_POLL_INTERVAL: Deno.env.get("AGENTMAIL_POLL_INTERVAL"),
    AGENTMAIL_POLICY: Deno.env.get("AGENTMAIL_POLICY"),
  };
  const raw = buildRawConfig(env, fileConfig);
  const clean = JSON.parse(JSON.stringify(raw));
  return ConfigSchema.parse(clean);
}
