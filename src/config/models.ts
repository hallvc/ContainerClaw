import type { Config, ModelRole } from "./schema.ts";

/**
 * Resolve the model identifier for a given role.
 *
 * Resolution order:
 *   1. agents.models.<role>  (explicit per-role)
 *   2. agents.models.default (explicit default in models map)
 *   3. openrouter.default_model (provider-level fallback)
 */
export function resolveModel(config: Config, role: ModelRole): string {
  const models = config.agents.models;
  return models[role] || models.default || config.openrouter.default_model;
}
