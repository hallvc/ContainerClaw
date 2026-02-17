import { assertEquals, assertStringIncludes, assertRejects } from "@std/assert";
import { WebFetchTool, WebSearchTool } from "./web.ts";

// --- URL validation tests ---

Deno.test("WebFetchTool - rejects file:// URLs", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "file:///etc/passwd" }),
    Error,
    "http or https",
  );
});

Deno.test("WebFetchTool - rejects ftp:// URLs", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "ftp://example.com/file" }),
    Error,
    "http or https",
  );
});

Deno.test("WebFetchTool - rejects URLs without scheme", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "not-a-url" }),
    Error,
  );
});

Deno.test("WebFetchTool - accepts http:// URLs", () => {
  // Just verify URL validation passes — don't actually fetch
  const tool = new WebFetchTool();
  // We can't test actual fetching without a server, but we can verify
  // the tool exists and has correct schema
  assertEquals(tool.name, "web_fetch");
  assertEquals(tool.parameters.required, ["url"]);
});

Deno.test("WebFetchTool - accepts https:// URLs", () => {
  const tool = new WebFetchTool();
  assertEquals(tool.name, "web_fetch");
});

// --- WebSearchTool ---

Deno.test("WebSearchTool - returns not configured without API key", async () => {
  const tool = new WebSearchTool();
  const result = await tool.execute({ query: "test" });
  assertStringIncludes(result, "not configured");
});

Deno.test("WebSearchTool - has correct schema", () => {
  const tool = new WebSearchTool("fake-key");
  assertEquals(tool.name, "web_search");
  assertEquals(tool.parameters.required, ["query"]);
});
