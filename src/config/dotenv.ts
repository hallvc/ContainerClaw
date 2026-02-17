import { join } from "@std/path";
import { load } from "@std/dotenv";

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveDotenvPath(
  configDir: string,
): Promise<string | undefined> {
  const explicit = Deno.env.get("NANOBOT_DOTENV_PATH");
  if (explicit) return explicit;

  const sibling = join(configDir, ".env");
  if (await fileExists(sibling)) return sibling;

  return undefined;
}

export async function loadDotenv(configDir: string): Promise<void> {
  const envPath = await resolveDotenvPath(configDir);
  if (!envPath) return;

  await load({ envPath, export: true });
}
