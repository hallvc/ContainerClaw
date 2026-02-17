import { ConfigSchema, type Config } from "./schema.ts";

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

export async function loadConfig(): Promise<Config> {
  const fileConfig = await readFileConfig("/data/config.json");

  const model = Deno.env.get("NANOBOT_MODEL");

  const raw = {
    workspace: Deno.env.get("NANOBOT_WORKSPACE") ?? (fileConfig.workspace as string | undefined),
    data_dir: Deno.env.get("NANOBOT_DATA_DIR") ?? (fileConfig.data_dir as string | undefined),
    slack: {
      bot_token: Deno.env.get("SLACK_BOT_TOKEN"),
      app_token: Deno.env.get("SLACK_APP_TOKEN"),
      group_policy: Deno.env.get("SLACK_GROUP_POLICY"),
      ...((fileConfig.slack as Record<string, unknown> | undefined) ?? {}),
    },
    openrouter: {
      api_key: Deno.env.get("OPENROUTER_API_KEY"),
      default_model: model,
      ...((fileConfig.openrouter as Record<string, unknown> | undefined) ?? {}),
    },
    agents: {
      model,
      temperature: parseOptionalFloat(Deno.env.get("NANOBOT_TEMPERATURE")),
      max_tokens: parseOptionalInt(Deno.env.get("NANOBOT_MAX_TOKENS")),
      memory_window: parseOptionalInt(Deno.env.get("NANOBOT_MEMORY_WINDOW")),
      ...((fileConfig.agents as Record<string, unknown> | undefined) ?? {}),
    },
    web_search: {
      brave_api_key: Deno.env.get("BRAVE_API_KEY"),
      ...((fileConfig.web_search as Record<string, unknown> | undefined) ?? {}),
    },
  };

  // Strip undefined values so Zod defaults apply
  const clean = JSON.parse(JSON.stringify(raw, (_k, v) => v === undefined ? undefined : v));

  return ConfigSchema.parse(clean);
}
