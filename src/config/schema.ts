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

export const OpenRouterConfigSchema = z.object({
  api_key: z.string().default(""),
  default_model: z.string().default("anthropic/claude-sonnet-4-5"),
});

export const AgentsConfigSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().positive().default(4096),
  memory_window: z.number().int().positive().default(50),
  max_iterations: z.number().int().positive().default(20),
});

export const WebSearchConfigSchema = z.object({
  brave_api_key: z.string().optional(),
});

export const ConfigSchema = z.object({
  slack: SlackConfigSchema.default({}),
  openrouter: OpenRouterConfigSchema.default({}),
  agents: AgentsConfigSchema.default({}),
  web_search: WebSearchConfigSchema.default({}),
  workspace: z.string().default("/workspace"),
  data_dir: z.string().default("/data"),
});

export type SlackDMConfig = z.infer<typeof SlackDMConfigSchema>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type OpenRouterConfig = z.infer<typeof OpenRouterConfigSchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

/** Workspace confinement is always enforced — not configurable. */
export const RESTRICT_TO_WORKSPACE = true as const;
