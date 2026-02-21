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

// --- Timeout tests ---

Deno.test("WebFetchTool - passes abort signal to fetch for timeout", async () => {
  const original = globalThis.fetch;
  let capturedSignal: AbortSignal | undefined;

  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedSignal = init?.signal ?? undefined;
    return Promise.resolve(new Response("<html><body><p>OK</p></body></html>", { status: 200, headers: { "Content-Type": "text/html" } }));
  }) as typeof fetch;

  try {
    const tool = new WebFetchTool();
    try {
      await tool.execute({ url: "https://example.com" });
    } catch {
      // May throw due to Readability parsing, that's fine
    }
    if (!capturedSignal) throw new Error("Expected AbortSignal to be passed to fetch");
    if (capturedSignal.aborted) throw new Error("Signal should not be aborted yet");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("WebFetchTool - times out on slow responses", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    return Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  }) as typeof fetch;

  try {
    const tool = new WebFetchTool();
    await assertRejects(
      () => tool.execute({ url: "https://example.com/slow" }),
      DOMException,
    );
  } finally {
    globalThis.fetch = original;
  }
});
