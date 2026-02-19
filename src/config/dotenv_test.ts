import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadDotenv, resolveDotenvPath } from "./dotenv.ts";

Deno.test("resolveDotenvPath - returns CONTAINERCLAW_DOTENV_PATH when set", async () => {
  const original = Deno.env.get("CONTAINERCLAW_DOTENV_PATH");
  Deno.env.set("CONTAINERCLAW_DOTENV_PATH", "/tmp/custom.env");
  try {
    const result = await resolveDotenvPath("/some/dir");
    assertEquals(result, "/tmp/custom.env");
  } finally {
    if (original) Deno.env.set("CONTAINERCLAW_DOTENV_PATH", original);
    else Deno.env.delete("CONTAINERCLAW_DOTENV_PATH");
  }
});

Deno.test("resolveDotenvPath - returns sibling .env when it exists", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const envPath = join(tmpDir, ".env");
    await Deno.writeTextFile(envPath, "FOO=bar\n");
    const result = await resolveDotenvPath(tmpDir);
    assertEquals(result, envPath);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("resolveDotenvPath - returns undefined when no .env exists", async () => {
  const tmpDir = await Deno.makeTempDir();
  const original = Deno.env.get("CONTAINERCLAW_DOTENV_PATH");
  Deno.env.delete("CONTAINERCLAW_DOTENV_PATH");
  try {
    const result = await resolveDotenvPath(tmpDir);
    assertEquals(result, undefined);
  } finally {
    if (original) Deno.env.set("CONTAINERCLAW_DOTENV_PATH", original);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("loadDotenv - populates Deno.env from .env file", async () => {
  const tmpDir = await Deno.makeTempDir();
  const key = "CONTAINERCLAW_TEST_DOTENV_VALUE";
  try {
    await Deno.writeTextFile(
      join(tmpDir, ".env"),
      `${key}=hello_from_dotenv\n`,
    );
    Deno.env.delete(key);
    await loadDotenv(tmpDir);
    assertEquals(Deno.env.get(key), "hello_from_dotenv");
  } finally {
    Deno.env.delete(key);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("loadDotenv - does NOT overwrite existing env vars", async () => {
  const tmpDir = await Deno.makeTempDir();
  const key = "CONTAINERCLAW_TEST_DOTENV_EXISTING";
  try {
    Deno.env.set(key, "original_value");
    await Deno.writeTextFile(
      join(tmpDir, ".env"),
      `${key}=overwritten_value\n`,
    );
    await loadDotenv(tmpDir);
    assertEquals(Deno.env.get(key), "original_value");
  } finally {
    Deno.env.delete(key);
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("loadDotenv - silent when no .env file found", async () => {
  const tmpDir = await Deno.makeTempDir();
  const original = Deno.env.get("CONTAINERCLAW_DOTENV_PATH");
  Deno.env.delete("CONTAINERCLAW_DOTENV_PATH");
  try {
    // Should not throw
    await loadDotenv(tmpDir);
  } finally {
    if (original) Deno.env.set("CONTAINERCLAW_DOTENV_PATH", original);
    await Deno.remove(tmpDir, { recursive: true });
  }
});
