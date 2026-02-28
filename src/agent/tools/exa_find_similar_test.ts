import { assertEquals, assertRejects } from "@std/assert";
import { ExaFindSimilarTool } from "./exa_find_similar.ts";
import type { ExaClient } from "../../providers/exa_client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PostJSONArgs = { path: string; body: Record<string, unknown> };

function makeClient(responseBody: unknown, status = 200): ExaClient & { calls: PostJSONArgs[] } {
  const calls: PostJSONArgs[] = [];
  return {
    calls,
    postJSON: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body });
      return new Response(JSON.stringify(responseBody), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  } as unknown as ExaClient & { calls: PostJSONArgs[] };
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

Deno.test("ExaFindSimilarTool - tool name is exa_find_similar", () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  assertEquals(tool.name, "exa_find_similar");
});

// ---------------------------------------------------------------------------
// execute: empty url guard
// ---------------------------------------------------------------------------

Deno.test("ExaFindSimilarTool - returns error message when url is empty string", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  const result = await tool.execute({ url: "" });
  assertEquals(result, "Error: url is required.");
});

Deno.test("ExaFindSimilarTool - returns error message when url is missing", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  const result = await tool.execute({});
  assertEquals(result, "Error: url is required.");
});

// ---------------------------------------------------------------------------
// execute: result formatting
// ---------------------------------------------------------------------------

Deno.test("ExaFindSimilarTool - formats results as a numbered list", async () => {
  const client = makeClient({
    results: [
      { title: "First Result", url: "https://first.com", text: "Description of first." },
      { title: "Second Result", url: "https://second.com", text: "Description of second." },
    ],
  });
  const tool = new ExaFindSimilarTool(client);
  const result = await tool.execute({ url: "https://example.com" });
  assertEquals(
    result,
    "1. First Result\n   https://first.com\n   Description of first.\n\n2. Second Result\n   https://second.com\n   Description of second.",
  );
});

Deno.test("ExaFindSimilarTool - falls back to Untitled when title is missing", async () => {
  const client = makeClient({
    results: [{ url: "https://example.com", text: "Some text." }],
  });
  const tool = new ExaFindSimilarTool(client);
  const result = await tool.execute({ url: "https://ref.com" });
  assertEquals(result, "1. Untitled\n   https://example.com\n   Some text.");
});

Deno.test("ExaFindSimilarTool - truncates text snippet to 200 characters", async () => {
  const longText = "A".repeat(300);
  const client = makeClient({
    results: [{ title: "Long Page", url: "https://example.com", text: longText }],
  });
  const tool = new ExaFindSimilarTool(client);
  const result = await tool.execute({ url: "https://ref.com" });
  assertEquals(result, `1. Long Page\n   https://example.com\n   ${"A".repeat(200)}`);
});

Deno.test("ExaFindSimilarTool - returns no similar pages message when results are empty", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  const result = await tool.execute({ url: "https://example.com" });
  assertEquals(result, "No similar pages found.");
});

// ---------------------------------------------------------------------------
// execute: optional domain filters
// ---------------------------------------------------------------------------

Deno.test("ExaFindSimilarTool - does not send includeDomains when not provided", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  await tool.execute({ url: "https://example.com" });
  const sentBody = client.calls[0].body;
  assertEquals("includeDomains" in sentBody, false);
});

Deno.test("ExaFindSimilarTool - does not send excludeDomains when not provided", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  await tool.execute({ url: "https://example.com" });
  const sentBody = client.calls[0].body;
  assertEquals("excludeDomains" in sentBody, false);
});

Deno.test("ExaFindSimilarTool - sends includeDomains when provided", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  await tool.execute({ url: "https://example.com", includeDomains: ["wikipedia.org", "github.com"] });
  const sentBody = client.calls[0].body;
  assertEquals(sentBody.includeDomains, ["wikipedia.org", "github.com"]);
});

Deno.test("ExaFindSimilarTool - sends excludeDomains when provided", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  await tool.execute({ url: "https://example.com", excludeDomains: ["spam.com"] });
  const sentBody = client.calls[0].body;
  assertEquals(sentBody.excludeDomains, ["spam.com"]);
});

Deno.test("ExaFindSimilarTool - does not send includeDomains when given empty array", async () => {
  const client = makeClient({ results: [] });
  const tool = new ExaFindSimilarTool(client);
  await tool.execute({ url: "https://example.com", includeDomains: [] });
  const sentBody = client.calls[0].body;
  assertEquals("includeDomains" in sentBody, false);
});

// ---------------------------------------------------------------------------
// execute: non-ok response throws
// ---------------------------------------------------------------------------

Deno.test("ExaFindSimilarTool - throws on non-ok HTTP response", async () => {
  const client = makeErrorClient(403, "Forbidden");
  const tool = new ExaFindSimilarTool(client);
  await assertRejects(
    () => tool.execute({ url: "https://example.com" }),
    Error,
    "HTTP 403",
  );
});

Deno.test("ExaFindSimilarTool - throws on 500 internal server error", async () => {
  const client = makeErrorClient(500, "Internal Server Error");
  const tool = new ExaFindSimilarTool(client);
  await assertRejects(
    () => tool.execute({ url: "https://example.com" }),
    Error,
    "HTTP 500",
  );
});
