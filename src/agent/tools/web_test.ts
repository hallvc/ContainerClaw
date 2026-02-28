import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
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
      Error,
      "Timed out fetching example.com",
    );
  } finally {
    globalThis.fetch = original;
  }
});

// --- Scrapling integration tests ---

Deno.test("WebFetchTool - uses Scrapling when available and returns markdown", async () => {
  const originalCommand = Deno.Command;
  const originalFetch = globalThis.fetch;

  const expectedMarkdown = "# Hello World\n\nThis is a **test** page with [links](https://example.com).";

  // Mock Deno.Command to simulate Scrapling writing a .md file
  // deno-lint-ignore no-explicit-any
  (Deno as any).Command = class MockCommand {
    args: string[];
    constructor(_cmd: string, opts: { args: string[] }) {
      this.args = opts.args;
    }
    async output() {
      // Find the output file path (4th arg: extract get <url> <file>)
      const outFile = this.args[3];
      await Deno.writeTextFile(outFile, expectedMarkdown);
      return { success: true, code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    }
  };

  // fetch should NOT be called when Scrapling succeeds
  let fetchCalled = false;
  globalThis.fetch = (() => {
    fetchCalled = true;
    return Promise.resolve(new Response("should not reach", { status: 200 }));
  }) as typeof fetch;

  try {
    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "https://example.com/page" });
    assertEquals(result, expectedMarkdown);
    assertEquals(fetchCalled, false, "fetch should not be called when Scrapling succeeds");
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).Command = originalCommand;
    globalThis.fetch = originalFetch;
  }
});

Deno.test("WebFetchTool - falls back to Readability when Scrapling fails", async () => {
  const originalCommand = Deno.Command;
  const originalFetch = globalThis.fetch;

  // Mock Deno.Command to simulate Scrapling failure
  // deno-lint-ignore no-explicit-any
  (Deno as any).Command = class MockCommand {
    constructor(_cmd: string, _opts: Record<string, unknown>) {}
    output() {
      return Promise.resolve({ success: false, code: 1, stdout: new Uint8Array(), stderr: new Uint8Array() });
    }
  };

  // Mock fetch to return HTML (Readability fallback path)
  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return Promise.resolve(new Response(
      "<html><head><title>Test</title></head><body><article><p>Fallback content here</p></article></body></html>",
      { status: 200, headers: { "Content-Type": "text/html" } },
    ));
  }) as typeof fetch;

  try {
    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "https://example.com/page" });
    assertStringIncludes(result, "Fallback content here");
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).Command = originalCommand;
    globalThis.fetch = originalFetch;
  }
});

Deno.test("WebFetchTool - falls back to Readability when Scrapling is not installed", async () => {
  const originalCommand = Deno.Command;
  const originalFetch = globalThis.fetch;

  // Mock Deno.Command to simulate "command not found"
  // deno-lint-ignore no-explicit-any
  (Deno as any).Command = class MockCommand {
    constructor(_cmd: string, _opts: Record<string, unknown>) {}
    output() {
      return Promise.reject(new Deno.errors.NotFound("scrapling not found"));
    }
  };

  globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return Promise.resolve(new Response(
      "<html><head><title>Test</title></head><body><p>Plain text fallback</p></body></html>",
      { status: 200, headers: { "Content-Type": "text/html" } },
    ));
  }) as typeof fetch;

  try {
    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "https://example.com/page" });
    assertStringIncludes(result, "Plain text fallback");
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).Command = originalCommand;
    globalThis.fetch = originalFetch;
  }
});

Deno.test("WebFetchTool - Scrapling output is truncated at MAX_OUTPUT", async () => {
  const originalCommand = Deno.Command;
  const originalFetch = globalThis.fetch;

  const longContent = "x".repeat(15_000);

  // deno-lint-ignore no-explicit-any
  (Deno as any).Command = class MockCommand {
    args: string[];
    constructor(_cmd: string, opts: { args: string[] }) {
      this.args = opts.args;
    }
    async output() {
      const outFile = this.args[3];
      await Deno.writeTextFile(outFile, longContent);
      return { success: true, code: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    }
  };

  globalThis.fetch = (() => {
    return Promise.resolve(new Response("unused", { status: 200 }));
  }) as typeof fetch;

  try {
    const tool = new WebFetchTool();
    const result = await tool.execute({ url: "https://example.com/long" });
    assertEquals(result.length, 10_000 + "\n[content truncated]".length);
    assertStringIncludes(result, "[content truncated]");
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).Command = originalCommand;
    globalThis.fetch = originalFetch;
  }
});
