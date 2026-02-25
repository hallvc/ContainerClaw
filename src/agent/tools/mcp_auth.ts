/**
 * MCP OAuth client provider and auth utilities.
 *
 * Implements the SDK's OAuthClientProvider interface backed by mcp_servers.json
 * for persistent token/client storage. Also provides a local callback server
 * for the OAuth browser redirect flow and a cross-platform browser opener.
 */

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { loadMcpConfig, saveMcpConfig } from "./mcp.ts";
import type { MCPServerConfig } from "./mcp.ts";

const CALLBACK_PORT = 8090;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;
const OAUTH_TIMEOUT_MS = 120_000;

/**
 * OAuthClientProvider implementation that persists tokens and client info
 * to mcp_servers.json via the saveMcpConfig helper.
 */
export class ContainerclawOAuthProvider implements OAuthClientProvider {
  private _serverName: string;
  private _workspace: string;
  private _config: MCPServerConfig;
  private _onRedirect: (url: URL) => void | Promise<void>;

  constructor(
    serverName: string,
    workspace: string,
    config: MCPServerConfig,
    onRedirect: (url: URL) => void | Promise<void>,
  ) {
    this._serverName = serverName;
    this._workspace = workspace;
    this._config = config;
    this._onRedirect = onRedirect;
  }

  get redirectUrl(): string {
    return CALLBACK_URL;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "containerclaw",
      // deno-lint-ignore no-explicit-any
      redirect_uris: [new URL(CALLBACK_URL)] as any,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this._config.oauth?.clientInformation as
      | OAuthClientInformationMixed
      | undefined;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    if (!this._config.oauth) this._config.oauth = {};
    this._config.oauth.clientInformation = clientInformation;
    await this._persistConfig();
  }

  tokens(): OAuthTokens | undefined {
    return this._config.oauth?.tokens as OAuthTokens | undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    if (!this._config.oauth) this._config.oauth = {};
    this._config.oauth.tokens = tokens;
    await this._persistConfig();
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this._onRedirect(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    if (!this._config.oauth) this._config.oauth = {};
    this._config.oauth.codeVerifier = codeVerifier;
    await this._persistConfig();
  }

  codeVerifier(): string {
    const verifier = this._config.oauth?.codeVerifier;
    if (!verifier) throw new Error("No code verifier saved");
    return verifier;
  }

  private async _persistConfig(): Promise<void> {
    const allServers = await loadMcpConfig(this._workspace);
    allServers[this._serverName] = this._config;
    await saveMcpConfig(this._workspace, allServers);
  }
}

/**
 * Start a temporary HTTP server to receive the OAuth callback.
 * Returns the authorization code from the redirect.
 */
export function waitForOAuthCallback(
  port: number = CALLBACK_PORT,
  timeoutMs: number = OAUTH_TIMEOUT_MS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const ac = new AbortController();

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ac.abort();
        reject(
          new Error(
            `OAuth authorization timed out after ${timeoutMs / 1000}s. Run 'containerclaw mcp-add' again to retry.`,
          ),
        );
      }
    }, timeoutMs);

    Deno.serve({ port, signal: ac.signal, onListen: () => {} }, (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 404 });
      }

      if (url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 });
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (code && !settled) {
        settled = true;
        clearTimeout(timer);
        setTimeout(() => ac.abort(), 500);
        resolve(code);
        return new Response(
          `<html><body><h1>Authorization Successful!</h1><p>You can close this window and return to the terminal.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }

      if (error && !settled) {
        settled = true;
        clearTimeout(timer);
        setTimeout(() => ac.abort(), 500);
        reject(new Error(`OAuth authorization failed: ${error}`));
        return new Response(
          `<html><body><h1>Authorization Failed</h1><p>Error: ${error}</p></body></html>`,
          { status: 400, headers: { "Content-Type": "text/html" } },
        );
      }

      return new Response("Bad request", { status: 400 });
    });
  });
}

/** Open a URL in the user's default browser (cross-platform). */
export function openBrowser(url: string): void {
  let cmd: string;
  let args: string[];

  switch (Deno.build.os) {
    case "darwin":
      cmd = "open";
      args = [url];
      break;
    case "linux":
      cmd = "xdg-open";
      args = [url];
      break;
    case "windows":
      cmd = "cmd";
      args = ["/c", "start", url];
      break;
    default:
      console.log(`Please open this URL in your browser: ${url}`);
      return;
  }

  try {
    new Deno.Command(cmd, {
      args,
      stdout: "null",
      stderr: "null",
    }).spawn();
  } catch {
    console.log(
      `Could not open browser. Please open this URL manually: ${url}`,
    );
  }
}

/**
 * Perform the OAuth callback flow after the SDK has redirected the user.
 * Spins up the local callback server, waits for the authorization code,
 * and calls transport.finishAuth() to complete the token exchange.
 */
export async function performOAuthFlow(
  transport: { finishAuth(code: string): Promise<void> },
  options?: { port?: number; timeoutMs?: number },
): Promise<string> {
  const port = options?.port ?? CALLBACK_PORT;
  const timeoutMs = options?.timeoutMs ?? OAUTH_TIMEOUT_MS;
  const authCode = await waitForOAuthCallback(port, timeoutMs);
  await transport.finishAuth(authCode);
  return authCode;
}

export { CALLBACK_PORT, CALLBACK_URL, OAUTH_TIMEOUT_MS };
