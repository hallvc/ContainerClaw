import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ContainerclawOAuthProvider, CALLBACK_URL } from "./mcp_auth.ts";
import { loadMcpConfig } from "./mcp.ts";
import type { MCPServerConfig } from "./mcp.ts";

// --- ContainerclawOAuthProvider tests ---

Deno.test("OAuthProvider - returns correct redirectUrl", () => {
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    () => {},
  );
  assertEquals(provider.redirectUrl, CALLBACK_URL);
});

Deno.test("OAuthProvider - returns correct clientMetadata", () => {
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    () => {},
  );
  const meta = provider.clientMetadata;
  assertEquals(meta.client_name, "containerclaw");
  assertEquals(meta.token_endpoint_auth_method, "none");
  assertEquals(meta.grant_types, ["authorization_code", "refresh_token"]);
  assertEquals(meta.response_types, ["code"]);
  assertEquals(meta.redirect_uris.length, 1);
});

Deno.test("OAuthProvider - returns undefined clientInformation when not set", () => {
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    () => {},
  );
  assertEquals(provider.clientInformation(), undefined);
});

Deno.test("OAuthProvider - returns undefined tokens when not set", () => {
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    () => {},
  );
  assertEquals(provider.tokens(), undefined);
});

Deno.test("OAuthProvider - returns tokens from config when set", () => {
  const config: MCPServerConfig = {
    url: "https://example.com/mcp",
    oauth: {
      tokens: { access_token: "abc123", token_type: "Bearer" },
    },
  };
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    () => {},
  );
  const tokens = provider.tokens();
  assertEquals(tokens?.access_token, "abc123");
  assertEquals(tokens?.token_type, "Bearer");
});

Deno.test("OAuthProvider - returns clientInformation from config when set", () => {
  const config: MCPServerConfig = {
    url: "https://example.com/mcp",
    oauth: {
      clientInformation: { client_id: "my-client-id" },
    },
  };
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    () => {},
  );
  const info = provider.clientInformation();
  // deno-lint-ignore no-explicit-any
  assertEquals((info as any)?.client_id, "my-client-id");
});

Deno.test("OAuthProvider - throws when no code verifier saved", () => {
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    () => {},
  );
  assertThrows(
    () => provider.codeVerifier(),
    Error,
    "No code verifier saved",
  );
});

Deno.test("OAuthProvider - returns code verifier when set", () => {
  const config: MCPServerConfig = {
    url: "https://example.com/mcp",
    oauth: { codeVerifier: "test-verifier-123" },
  };
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    () => {},
  );
  assertEquals(provider.codeVerifier(), "test-verifier-123");
});

Deno.test("OAuthProvider - saveTokens persists to config", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const provider = new ContainerclawOAuthProvider(
    "testserver",
    tmpDir,
    config,
    () => {},
  );

  await provider.saveTokens({
    access_token: "new-token",
    token_type: "Bearer",
  });

  const loaded = await loadMcpConfig(tmpDir);
  assertEquals(
    loaded.testserver?.oauth?.tokens?.access_token,
    "new-token",
  );
});

Deno.test("OAuthProvider - saveClientInformation persists to config", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const provider = new ContainerclawOAuthProvider(
    "testserver",
    tmpDir,
    config,
    () => {},
  );

  // deno-lint-ignore no-explicit-any
  await provider.saveClientInformation({ client_id: "saved-client" } as any);

  const loaded = await loadMcpConfig(tmpDir);
  assertEquals(
    loaded.testserver?.oauth?.clientInformation?.client_id,
    "saved-client",
  );
});

Deno.test("OAuthProvider - saveCodeVerifier persists to config", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const provider = new ContainerclawOAuthProvider(
    "testserver",
    tmpDir,
    config,
    () => {},
  );

  await provider.saveCodeVerifier("pkce-verifier-abc");

  const loaded = await loadMcpConfig(tmpDir);
  assertEquals(loaded.testserver?.oauth?.codeVerifier, "pkce-verifier-abc");
});

Deno.test("OAuthProvider - redirectToAuthorization calls onRedirect callback", async () => {
  const config: MCPServerConfig = { url: "https://example.com/mcp" };
  const captured: string[] = [];
  const provider = new ContainerclawOAuthProvider(
    "test",
    "/tmp",
    config,
    (url: URL) => {
      captured.push(url.toString());
    },
  );

  await provider.redirectToAuthorization(
    new URL("https://auth.example.com/authorize?client_id=test"),
  );

  assertEquals(captured.length, 1);
  assertEquals(
    captured[0],
    "https://auth.example.com/authorize?client_id=test",
  );
});

// --- performOAuthFlow tests ---

Deno.test({
  name: "performOAuthFlow - calls finishAuth with authorization code",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { performOAuthFlow } = await import("./mcp_auth.ts");

    const finishAuthCalls: string[] = [];
    const mockTransport = {
      finishAuth(code: string) {
        finishAuthCalls.push(code);
        return Promise.resolve();
      },
    };

    // Use a unique port to avoid conflicts, short timeout
    const port = 18990;

    // Start the OAuth flow in the background
    const flowPromise = performOAuthFlow(mockTransport, { port, timeoutMs: 5000 });

    // Simulate the browser redirect callback
    await new Promise((r) => setTimeout(r, 200));
    const resp = await fetch(`http://localhost:${port}/callback?code=test-auth-code-123`);
    assertEquals(resp.status, 200);
    await resp.body?.cancel();

    const result = await flowPromise;
    assertEquals(result, "test-auth-code-123");
    assertEquals(finishAuthCalls, ["test-auth-code-123"]);
  },
});

Deno.test("performOAuthFlow - propagates timeout error", async () => {
  const { performOAuthFlow } = await import("./mcp_auth.ts");

  const mockTransport = {
    finishAuth(_code: string) {
      return Promise.resolve();
    },
  };

  await assertRejects(
    () => performOAuthFlow(mockTransport, { port: 18991, timeoutMs: 100 }),
    Error,
    "timed out",
  );
});

// --- waitForOAuthCallback tests ---

Deno.test("waitForOAuthCallback - times out with clear message", async () => {
  const { waitForOAuthCallback } = await import("./mcp_auth.ts");
  await assertRejects(
    () => waitForOAuthCallback(18999, 100),
    Error,
    "timed out",
  );
});
