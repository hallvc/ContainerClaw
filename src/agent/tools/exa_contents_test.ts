import { assertEquals, assertRejects } from "@std/assert";
import { ExaContentsTool } from "./exa_contents.ts";
import type { ExaClient } from "../../providers/exa_client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(responseBody: unknown, status = 200): ExaClient {
  return {
    postJSON: async (_path: string, _body: Record<string, unknown>) =>
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  } as unknown as ExaClient;
}

function makeErrorClient(status: number, errorText: string): ExaClient {
  return {
    postJSON: async (_path: string, _body: Record<string, unknown>) =>
      new Response(errorText, { status }),
  } as unknown as ExaClient;
}

// ---------------------------------------------------------------------------
// Tool identity tests
// ---------------------------------------------------------------------------

Deno.test("ExaContentsTool - tool name is exa_contents", () => {
  const client = makeClient({ results: [] });
  const tool = new ExaContentsTool(client);
  assertEquals(tool.name, "exa_contents");
});

// ---------------------------------------------------------------------------
// execute: empty urls guard
// ---------------------------------------------------------------------------

Deno.test("ExaContentsTool - returns error message when urls is empty array", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaContentsTool(client);
  const result = await tool.execute({ urls: [] });
  assertEquals(result, "Error: urls is required.");
});

Deno.test("ExaContentsTool - returns error message when urls is missing", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaContentsTool(client);
  const result = await tool.execute({});
  assertEquals(result, "Error: urls is required.");
});

// ---------------------------------------------------------------------------
// execute: result formatting
// ---------------------------------------------------------------------------

Deno.test("ExaContentsTool - formats single result with title, url, and text", async () => {
  const client = makeClient({
    results: [
      {
        title: "Example Page",
        url: "https://example.com",
        text: "Some body text here.",
      },
    ],
  });
  const tool = new ExaContentsTool(client);
  const result = await tool.execute({ urls: ["https://example.com"] });
  assertEquals(result, "## Example Page\nhttps://example.com\n\nSome body text here.");
});

Deno.test("ExaContentsTool - formats multiple results separated by ---", async () => {
  const client = makeClient({
    results: [
      { title: "First", url: "https://first.com", text: "First content." },
      { title: "Second", url: "https://second.com", text: "Second content." },
    ],
  });
  const tool = new ExaContentsTool(client);
  const result = await tool.execute({ urls: ["https://first.com", "https://second.com"] });
  assertEquals(
    result,
    "## First\nhttps://first.com\n\nFirst content.\n\n---\n\n## Second\nhttps://second.com\n\nSecond content.",
  );
});

Deno.test("ExaContentsTool - falls back to Untitled when title is missing", async () => {
  const client = makeClient({
    results: [{ url: "https://example.com", text: "Content." }],
  });
  const tool = new ExaContentsTool(client);
  const result = await tool.execute({ urls: ["https://example.com"] });
  assertEquals(result, "## Untitled\nhttps://example.com\n\nContent.");
});

Deno.test("ExaContentsTool - falls back to empty string when url is missing", async () => {
  const client = makeClient({
    results: [{ title: "No URL Page", text: "Content." }],
  });
  const tool = new ExaContentsTool(client);
  const result = await tool.execute({ urls: ["https://example.com"] });
  assertEquals(result, "## No URL Page\n\n\nContent.");
});

Deno.test("ExaContentsTool - returns no content message when results array is empty", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaContentsTool(client);
  const result = await tool.execute({ urls: ["https://example.com"] });
  assertEquals(result, "No content returned.");
});

// ---------------------------------------------------------------------------
// execute: non-ok response throws
// ---------------------------------------------------------------------------

Deno.test("ExaContentsTool - throws on non-ok HTTP response", async () => {
  const client = makeErrorClient(403, "Forbidden");
  const tool = new ExaContentsTool(client);
  await assertRejects(
    () => tool.execute({ urls: ["https://example.com"] }),
    Error,
    "HTTP 403",
  );
});

Deno.test("ExaContentsTool - throws on 500 internal server error", async () => {
  const client = makeErrorClient(500, "Internal Server Error");
  const tool = new ExaContentsTool(client);
  await assertRejects(
    () => tool.execute({ urls: ["https://example.com"] }),
    Error,
    "HTTP 500",
  );
});
