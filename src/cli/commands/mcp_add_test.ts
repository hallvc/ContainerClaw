import { assertEquals } from "@std/assert";
import { parseCliArgs } from "../mod.ts";

// --- mcp-add CLI parsing tests ---

Deno.test("parseCliArgs - 'mcp-add' returns mcp-add command with empty options", () => {
  const result = parseCliArgs(["mcp-add"]);
  assertEquals(result, { command: "mcp-add", options: {} });
});

Deno.test("parseCliArgs - 'mcp-add --url' returns mcp-add with url option", () => {
  const result = parseCliArgs([
    "mcp-add",
    "--url",
    "https://example.com/mcp",
  ]);
  assertEquals(result, {
    command: "mcp-add",
    options: { url: "https://example.com/mcp" },
  });
});

Deno.test("parseCliArgs - 'mcp-add --name --url' returns both options", () => {
  const result = parseCliArgs([
    "mcp-add",
    "--name",
    "myserver",
    "--url",
    "https://example.com/mcp",
  ]);
  assertEquals(result, {
    command: "mcp-add",
    options: { name: "myserver", url: "https://example.com/mcp" },
  });
});

Deno.test("parseCliArgs - 'mcp-add --name' returns mcp-add with name option", () => {
  const result = parseCliArgs(["mcp-add", "--name", "granola"]);
  assertEquals(result, {
    command: "mcp-add",
    options: { name: "granola" },
  });
});
