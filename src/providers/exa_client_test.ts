import { assertEquals, assertRejects } from "@std/assert";
import { ExaClient } from "./exa_client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace the global fetch with a stub for the duration of a test. */
function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = (url: string, init: RequestInit) =>
    Promise.resolve(handler(url, init));
  return () => {
    globalThis.fetch = original;
  };
}

// ---------------------------------------------------------------------------
// Constructor tests
// ---------------------------------------------------------------------------

Deno.test("ExaClient - stores api key for use in requests", async () => {
  let capturedHeaders: Record<string, string> = {};
  const restore = stubFetch((_url, init) => {
    capturedHeaders = init.headers as Record<string, string>;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("test-api-key-123");
    await client.postJSON("/contents", {});
    assertEquals(capturedHeaders["x-api-key"], "test-api-key-123");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// postJSON URL tests
// ---------------------------------------------------------------------------

Deno.test("postJSON - builds correct URL from base and path", async () => {
  let capturedUrl = "";
  const restore = stubFetch((url, _init) => {
    capturedUrl = url;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("key");
    await client.postJSON("/search", {});
    assertEquals(capturedUrl, "https://api.exa.ai/search");
  } finally {
    restore();
  }
});

Deno.test("postJSON - builds correct URL for contents path", async () => {
  let capturedUrl = "";
  const restore = stubFetch((url, _init) => {
    capturedUrl = url;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("key");
    await client.postJSON("/contents", {});
    assertEquals(capturedUrl, "https://api.exa.ai/contents");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// postJSON headers tests
// ---------------------------------------------------------------------------

Deno.test("postJSON - sends x-api-key header", async () => {
  let capturedHeaders: Record<string, string> = {};
  const restore = stubFetch((_url, init) => {
    capturedHeaders = init.headers as Record<string, string>;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("my-secret-key");
    await client.postJSON("/answer", {});
    assertEquals(capturedHeaders["x-api-key"], "my-secret-key");
  } finally {
    restore();
  }
});

Deno.test("postJSON - sends Content-Type application/json header", async () => {
  let capturedHeaders: Record<string, string> = {};
  const restore = stubFetch((_url, init) => {
    capturedHeaders = init.headers as Record<string, string>;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("key");
    await client.postJSON("/search", {});
    assertEquals(capturedHeaders["Content-Type"], "application/json");
  } finally {
    restore();
  }
});

Deno.test("postJSON - sends Accept application/json header by default", async () => {
  let capturedHeaders: Record<string, string> = {};
  const restore = stubFetch((_url, init) => {
    capturedHeaders = init.headers as Record<string, string>;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("key");
    await client.postJSON("/search", {});
    assertEquals(capturedHeaders["Accept"], "application/json");
  } finally {
    restore();
  }
});

Deno.test("postJSON - sends custom Accept header when provided in opts", async () => {
  let capturedHeaders: Record<string, string> = {};
  const restore = stubFetch((_url, init) => {
    capturedHeaders = init.headers as Record<string, string>;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("key");
    await client.postJSON("/search", {}, { accept: "text/event-stream" });
    assertEquals(capturedHeaders["Accept"], "text/event-stream");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// postJSON body tests
// ---------------------------------------------------------------------------

Deno.test("postJSON - serialises body as JSON", async () => {
  let capturedBody = "";
  const restore = stubFetch((_url, init) => {
    capturedBody = init.body as string;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("key");
    await client.postJSON("/contents", { ids: ["https://example.com"], text: { maxCharacters: 500 } });
    const parsed = JSON.parse(capturedBody);
    assertEquals(parsed.ids, ["https://example.com"]);
    assertEquals(parsed.text.maxCharacters, 500);
  } finally {
    restore();
  }
});

Deno.test("postJSON - uses POST method", async () => {
  let capturedMethod = "";
  const restore = stubFetch((_url, init) => {
    capturedMethod = init.method as string;
    return new Response(JSON.stringify({}), { status: 200 });
  });

  try {
    const client = new ExaClient("key");
    await client.postJSON("/search", { query: "test" });
    assertEquals(capturedMethod, "POST");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// postJSON return value tests
// ---------------------------------------------------------------------------

Deno.test("postJSON - returns the raw Response object", async () => {
  const restore = stubFetch((_url, _init) =>
    new Response(JSON.stringify({ answer: "42" }), { status: 200 })
  );

  try {
    const client = new ExaClient("key");
    const response = await client.postJSON("/answer", { query: "meaning of life" });
    assertEquals(response.ok, true);
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.answer, "42");
  } finally {
    restore();
  }
});

Deno.test("postJSON - returns non-ok response without throwing", async () => {
  const restore = stubFetch((_url, _init) =>
    new Response("Unauthorized", { status: 401 })
  );

  try {
    const client = new ExaClient("bad-key");
    const response = await client.postJSON("/search", {});
    assertEquals(response.ok, false);
    assertEquals(response.status, 401);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// postJSON network error tests
// ---------------------------------------------------------------------------

Deno.test("postJSON - throws on network error after retries exhausted", async () => {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = () => Promise.reject(new TypeError("network failure"));

  try {
    const client = new ExaClient("key");
    await assertRejects(
      () => client.postJSON("/search", {}),
      TypeError,
      "network failure",
    );
  } finally {
    globalThis.fetch = original;
  }
});
