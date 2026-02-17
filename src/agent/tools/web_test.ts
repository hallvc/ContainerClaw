import { assertEquals, assertRejects } from "@std/assert";
import { WebFetchTool } from "./web.ts";

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
  const tool = new WebFetchTool();
  assertEquals(tool.name, "web_fetch");
  assertEquals(tool.parameters.required, ["url"]);
});

Deno.test("WebFetchTool - accepts https:// URLs", () => {
  const tool = new WebFetchTool();
  assertEquals(tool.name, "web_fetch");
});
