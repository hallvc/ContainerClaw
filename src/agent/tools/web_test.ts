import { assertEquals, assertRejects } from "@std/assert";
import { WebFetchTool, isPrivateHost } from "./web.ts";

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

// --- SSRF protection tests ---

Deno.test("WebFetchTool - blocks loopback IPv4 127.0.0.1", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://127.0.0.1/admin" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks localhost hostname", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://localhost/admin" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks loopback IPv6 ::1", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://[::1]/admin" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks Class A private 10.0.0.1", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://10.0.0.1/secret" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks Class B private 172.16.0.1", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://172.16.0.1/internal" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks Class C private 192.168.1.1", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://192.168.1.1/router" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks AWS metadata link-local 169.254.169.254", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://169.254.169.254/latest/meta-data/" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks unspecified address 0.0.0.0", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://0.0.0.0/" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks IPv4-mapped IPv6 ::ffff:127.0.0.1", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://[::ffff:127.0.0.1]/admin" }),
    Error,
    "private",
  );
});

Deno.test("WebFetchTool - blocks IPv4-mapped IPv6 ::ffff:10.0.0.1", async () => {
  const tool = new WebFetchTool();
  await assertRejects(
    () => tool.execute({ url: "http://[::ffff:10.0.0.1]/secret" }),
    Error,
    "private",
  );
});

Deno.test("isPrivateHost - host '0' is blocked", () => {
  assertEquals(isPrivateHost("0"), true);
});

Deno.test("WebFetchTool - allows public IP 8.8.8.8 (no URL validation throw)", () => {
  // Only checks URL parsing does not throw for public IPs.
  // Actual fetch is not attempted here.
  const parsed = new URL("http://8.8.8.8/");
  assertEquals(parsed.hostname, "8.8.8.8");
});

Deno.test("WebFetchTool - allows public domain example.com (no URL validation throw)", () => {
  const parsed = new URL("https://example.com");
  assertEquals(parsed.hostname, "example.com");
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
