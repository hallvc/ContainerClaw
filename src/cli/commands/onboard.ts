import { join } from "@std/path";
import { exists } from "@std/fs";

export interface OnboardOptions {
  apiKey?: string;
  model?: string;
  workspace?: string;
  dataDir?: string;
}

export const TEMPLATE_AGENTS_MD = `# Agent Instructions

Customize your agent's behavior and capabilities here.
Add guidelines, rules, and context that shape how the agent responds.
`;

export const TEMPLATE_SOUL_MD = `# Agent Personality

Describe your agent's personality, tone, and communication style.
This shapes how the agent interacts with users across all channels.
`;

export const TEMPLATE_USER_MD = `# User Context

Add information about yourself that the agent should know.
This helps the agent personalize its responses and understand your preferences.
`;

export function buildDefaultConfig(
  options: OnboardOptions,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    openrouter: {
      api_key: options.apiKey ?? "",
      default_model: options.model ?? "minimax/minimax-m2.5",
    },
  };
  if (options.workspace) config.workspace = options.workspace;
  if (options.dataDir) config.data_dir = options.dataDir;
  return config;
}

async function writeFileIfNotExists(
  path: string,
  content: string,
): Promise<boolean> {
  if (await exists(path)) return false;
  await Deno.writeTextFile(path, content);
  return true;
}

export async function writeOnboardFiles(
  configPath: string,
  workspace: string,
  dataDir: string,
  configData: Record<string, unknown>,
): Promise<void> {
  // Create directories
  await Deno.mkdir(dataDir, { recursive: true });
  await Deno.mkdir(workspace, { recursive: true });
  await Deno.mkdir(join(workspace, "skills"), { recursive: true });

  // Write config (don't overwrite existing)
  const wroteConfig = await writeFileIfNotExists(
    configPath,
    JSON.stringify(configData, null, 2) + "\n",
  );
  if (wroteConfig) {
    console.log(`  Created ${configPath}`);
  } else {
    console.log(`  Skipped ${configPath} (already exists)`);
  }

  // Write workspace templates (don't overwrite existing)
  const templates: [string, string][] = [
    [join(workspace, "AGENTS.md"), TEMPLATE_AGENTS_MD],
    [join(workspace, "SOUL.md"), TEMPLATE_SOUL_MD],
    [join(workspace, "USER.md"), TEMPLATE_USER_MD],
  ];

  for (const [path, content] of templates) {
    const wrote = await writeFileIfNotExists(path, content);
    if (wrote) {
      console.log(`  Created ${path}`);
    } else {
      console.log(`  Skipped ${path} (already exists)`);
    }
  }
}

export async function runOnboard(): Promise<void> {
  console.log("nanobot onboard");
  console.log("===============\n");
  console.log("This wizard will set up your nanobot configuration.\n");

  const home = Deno.env.get("HOME") ?? "";
  const defaultDataDir = join(home, ".nanobot", "data");
  const defaultWorkspace = join(home, ".nanobot", "workspace");

  const dataDir =
    prompt(`Data directory [${defaultDataDir}]:`) || defaultDataDir;
  const workspace =
    prompt(`Workspace directory [${defaultWorkspace}]:`) || defaultWorkspace;
  const apiKey = prompt("OpenRouter API key:") ?? "";
  const model =
    prompt("Default model [minimax/minimax-m2.5]:") || "minimax/minimax-m2.5";

  const configPath = join(dataDir, "config.json");
  const configData = buildDefaultConfig({
    apiKey,
    model,
    workspace,
    dataDir,
  });

  console.log("\nSetting up nanobot...\n");
  await writeOnboardFiles(configPath, workspace, dataDir, configData);

  console.log("\nSetup complete!\n");
  console.log("Next steps:");
  console.log(
    `  1. ${apiKey ? "API key configured" : "Add your OpenRouter API key to " + configPath}`,
  );
  console.log("  2. Run: deno task agent -m 'Hello!'");
  console.log("  3. Run: deno task agent  (for interactive mode)");
  console.log("  4. Run: deno task gateway  (to start channels)\n");
  console.log(
    "Get an API key at: https://openrouter.ai/keys",
  );
}
