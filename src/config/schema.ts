import { z } from "zod";

export const SlackDMConfigSchema = z.object({
  enabled: z.boolean().default(true),
  policy: z.enum(["open", "allowlist"]).default("open"),
  allow_from: z.array(z.string()).default([]),
});

export const SlackConfigSchema = z.object({
  bot_token: z.string().default(""),
  app_token: z.string().default(""),
  group_policy: z.enum(["mention", "open", "allowlist"]).default("mention"),
  group_allow_from: z.array(z.string()).default([]),
  dm: SlackDMConfigSchema.default({}),
});

export const TelegramConfigSchema = z.object({
  bot_token: z.string().default(""),
  allow_from: z.array(z.string()).default([]),
});

export const OpenRouterConfigSchema = z.object({
  api_key: z.string().default(""),
  default_model: z.string().default("minimax/minimax-m2.5"),
});

export const ModelRolesSchema = z.object({
  default: z.string().optional(),
  chat: z.string().optional(),
  memory: z.string().optional(),
});

export type ModelRole = keyof z.infer<typeof ModelRolesSchema>;

export const AgentsConfigSchema = z.object({
  models: ModelRolesSchema.default({}),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().positive().default(4096),
  memory_window: z.number().int().positive().default(50),
  max_iterations: z.number().int().positive().default(20),
});

export const EmailConfigSchema = z.object({
  api_key: z.string().default(""),
  inbox_id: z.string().default(""),
  username: z.string().default(""),
  domain: z.string().default(""),
  poll_interval_seconds: z.number().int().positive().default(15),
  policy: z.enum(["open", "allowlist"]).default("open"),
  allow_from: z.array(z.string()).default([]),
});

export const ToolsConfigSchema = z.object({
  exec_timeout_ms: z.number().int().positive().default(60_000),
});

export const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  interval_seconds: z.number().int().positive().default(1800),
});

export const ConfigSchema = z.object({
  slack: SlackConfigSchema.default({}),
  email: EmailConfigSchema.default({}),
  telegram: TelegramConfigSchema.default({}),
  openrouter: OpenRouterConfigSchema.default({}),
  agents: AgentsConfigSchema.default({}),
  tools: ToolsConfigSchema.default({}),
  heartbeat: HeartbeatConfigSchema.default({}),
  workspace: z.string().default("/workspace"),
  data_dir: z.string().default("/data"),
});

export type SlackDMConfig = z.infer<typeof SlackDMConfigSchema>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type OpenRouterConfig = z.infer<typeof OpenRouterConfigSchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/** Workspace confinement is always enforced — not configurable. */
export const RESTRICT_TO_WORKSPACE = true as const;
