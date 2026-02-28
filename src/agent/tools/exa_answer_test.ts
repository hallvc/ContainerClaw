import { assertEquals, assertRejects } from "@std/assert";
import { ExaAnswerTool } from "./exa_answer.ts";
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

Deno.test("ExaAnswerTool - tool name is exa_answer", () => {
  const client = makeClient({ answer: "yes" });
  const tool = new ExaAnswerTool(client);
  assertEquals(tool.name, "exa_answer");
});

// ---------------------------------------------------------------------------
// execute: empty query guard
// ---------------------------------------------------------------------------

Deno.test("ExaAnswerTool - returns error message when query is empty string", async () => {
  const client = makeClient({ answer: "yes" });
  const tool = new ExaAnswerTool(client);
  const result = await tool.execute({ query: "" });
  assertEquals(result, "Error: query is required.");
});

Deno.test("ExaAnswerTool - returns error message when query is missing", async () => {
  const client = makeClient({ answer: "yes" });
  const tool = new ExaAnswerTool(client);
  const result = await tool.execute({});
  assertEquals(result, "Error: query is required.");
});

// ---------------------------------------------------------------------------
// execute: result formatting
// ---------------------------------------------------------------------------

Deno.test("ExaAnswerTool - formats answer without citations when none provided", async () => {
  const client = makeClient({ answer: "The sky is blue." });
  const tool = new ExaAnswerTool(client);
  const result = await tool.execute({ query: "Why is the sky blue?" });
  assertEquals(result, "The sky is blue.");
});

Deno.test("ExaAnswerTool - formats answer with citations list", async () => {
  const client = makeClient({
    answer: "The sky is blue due to Rayleigh scattering.",
    citations: [
      { title: "Rayleigh Scattering Explained", url: "https://example.com/rayleigh" },
      { title: "Why Sky is Blue", url: "https://example.com/sky" },
    ],
  });
  const tool = new ExaAnswerTool(client);
  const result = await tool.execute({ query: "Why is the sky blue?" });
  assertEquals(
    result,
    "The sky is blue due to Rayleigh scattering.\n\n\n**Sources:**\n1. [Rayleigh Scattering Explained](https://example.com/rayleigh)\n2. [Why Sky is Blue](https://example.com/sky)",
  );
});

Deno.test("ExaAnswerTool - citation falls back to url when title is missing", async () => {
  const client = makeClient({
    answer: "Answer here.",
    citations: [
      { url: "https://example.com/source" },
    ],
  });
  const tool = new ExaAnswerTool(client);
  const result = await tool.execute({ query: "some question" });
  assertEquals(
    result,
    "Answer here.\n\n\n**Sources:**\n1. [https://example.com/source](https://example.com/source)",
  );
});

Deno.test("ExaAnswerTool - citation falls back to Source label when title and url are both missing", async () => {
  const client = makeClient({
    answer: "Answer here.",
    citations: [{}],
  });
  const tool = new ExaAnswerTool(client);
  const result = await tool.execute({ query: "some question" });
  assertEquals(
    result,
    "Answer here.\n\n\n**Sources:**\n1. [Source]()",
  );
});

Deno.test("ExaAnswerTool - returns no answer message when answer and citations are absent", async () => {
  const client = makeClient({});
  const tool = new ExaAnswerTool(client);
  const result = await tool.execute({ query: "some question" });
  assertEquals(result, "No answer returned.");
});

Deno.test("ExaAnswerTool - skips sources section when citations array is empty", async () => {
  const client = makeClient({ answer: "Just an answer.", citations: [] });
  const tool = new ExaAnswerTool(client);
  const result = await tool.execute({ query: "some question" });
  assertEquals(result, "Just an answer.");
});

// ---------------------------------------------------------------------------
// execute: non-ok response throws
// ---------------------------------------------------------------------------

Deno.test("ExaAnswerTool - throws on non-ok HTTP response", async () => {
  const client = makeErrorClient(401, "Unauthorized");
  const tool = new ExaAnswerTool(client);
  await assertRejects(
    () => tool.execute({ query: "some question" }),
    Error,
    "HTTP 401",
  );
});

Deno.test("ExaAnswerTool - throws on 500 internal server error", async () => {
  const client = makeErrorClient(500, "Internal Server Error");
  const tool = new ExaAnswerTool(client);
  await assertRejects(
    () => tool.execute({ query: "some question" }),
    Error,
    "HTTP 500",
  );
});
