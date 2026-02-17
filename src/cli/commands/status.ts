import { loadConfig } from "../../config/loader.ts";
import { resolveModel } from "../../config/models.ts";
import type { Config } from "../../config/schema.ts";

export interface StatusInfo {
  workspace: string;
  dataDir: string;
  model: { chat: string; memory: string };
  channels: {
    slack: boolean;
    email: boolean;
    telegram: boolean;
  };
  heartbeat: { enabled: boolean; intervalSeconds: number };
}

export function getStatus(config: Config): StatusInfo {
  return {
    workspace: config.workspace,
    dataDir: config.data_dir,
    model: {
      chat: resolveModel(config, "chat"),
      memory: resolveModel(config, "memory"),
    },
    channels: {
      slack: !!(config.slack.bot_token && config.slack.app_token),
      email: !!config.email.api_key,
      telegram: !!config.telegram.bot_token,
    },
    heartbeat: {
      enabled: config.heartbeat.enabled,
      intervalSeconds: config.heartbeat.interval_seconds,
    },
  };
}

function check(ok: boolean): string {
  return ok ? "\u2713" : "\u2717";
}

export function renderStatus(info: StatusInfo): string {
  const lines: string[] = [
    "nanobot status",
    "==============",
    "",
    `Workspace:    ${info.workspace}`,
    `Data dir:     ${info.dataDir}`,
    "",
    "Models:",
    `  Chat:       ${info.model.chat}`,
    `  Memory:     ${info.model.memory}`,
    "",
    "Channels:",
    `  ${check(info.channels.slack)} Slack`,
    `  ${check(info.channels.email)} Email`,
    `  ${check(info.channels.telegram)} Telegram`,
    "",
    `Heartbeat:    ${check(info.heartbeat.enabled)} ${info.heartbeat.enabled ? `(every ${info.heartbeat.intervalSeconds}s)` : "(disabled)"}`,
  ];
  return lines.join("\n");
}

export async function runStatus(): Promise<void> {
  const config = await loadConfig();
  const status = getStatus(config);
  console.log(renderStatus(status));
}
