/**
 * CLI command: mcp-add
 *
 * Interactive wizard for adding a URL-based MCP server with auth detection.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  loadMcpConfig,
  saveMcpConfig,
} from "../../agent/tools/mcp.ts";
import type { MCPServerConfig } from "../../agent/tools/mcp.ts";
import {
  ContainerclawOAuthProvider,
  openBrowser,
  waitForOAuthCallback,
} from "../../agent/tools/mcp_auth.ts";
import { join } from "@std/path";
import { exists } from "@std/fs";

export interface McpAddOptions {
  url?: string;
  name?: string;
}

/** Resolve workspace directory (same logic as config loader). */
async function resolveWorkspace(): Promise<string> {
  const home = Deno.env.get("HOME") ?? "";
  const defaultWorkspace = join(home, ".containerclaw", "workspace");

  // Check if a config file exists that specifies workspace
  const dataDir = join(home, ".containerclaw", "data");
  const configPath = join(dataDir, "config.json");
  try {
    if (await exists(configPath)) {
      const text = await Deno.readTextFile(configPath);
      const config = JSON.parse(text);
      if (config.workspace) return config.workspace;
    }
  } catch { /* use default */ }

  return defaultWorkspace;
}

/** Try connecting with Streamable HTTP, fall back to SSE. */
async function detectTransport(
  url: URL,
  opts: Record<string, unknown>,
): Promise<{
  transport: "streamable-http" | "sse";
  client: InstanceType<typeof Client>;
  // deno-lint-ignore no-explicit-any
  transportInstance: any;
}> {
  // Try Streamable HTTP first
  try {
    const transport = new StreamableHTTPClientTransport(url, opts);
    const client = new Client({ name: "containerclaw", version: "1.0.0" });
    await client.connect(transport);
    return { transport: "streamable-http", client, transportInstance: transport };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;

    // Fall back to SSE
    console.log("  Streamable HTTP failed, trying SSE...");
    const sseTransport = new SSEClientTransport(url, opts);
    const sseClient = new Client({ name: "containerclaw", version: "1.0.0" });
    await sseClient.connect(sseTransport);
    return {
      transport: "sse",
      client: sseClient,
      transportInstance: sseTransport,
    };
  }
}

export async function runMcpAdd(options: McpAddOptions): Promise<void> {
  console.log("Add MCP Server");
  console.log("==============\n");

  const workspace = await resolveWorkspace();
  await Deno.mkdir(workspace, { recursive: true });

  // Get server name
  const name = options.name ?? prompt("Server name:") ?? "";
  if (!name.trim()) {
    console.error("Server name is required.");
    return;
  }

  // Get server URL
  const url = options.url ?? prompt("Server URL:") ?? "";
  if (!url.trim()) {
    console.error("Server URL is required.");
    return;
  }

  // Validate URL
  let serverUrl: URL;
  try {
    serverUrl = new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    return;
  }

  console.log(`\nConnecting to ${serverUrl}...`);

  const config: MCPServerConfig = { url: url.trim() };

  // First attempt: no auth
  try {
    const result = await detectTransport(serverUrl, {});
    config.transport = result.transport;
    console.log(`  Transport: ${result.transport}`);

    // List tools
    const { tools } = await result.client.listTools();
    console.log(`  Connected! Found ${tools.length} tool(s).`);
    for (const tool of tools) {
      console.log(`    - ${tool.name}: ${tool.description ?? "(no description)"}`);
    }

    await result.client.close();
    await saveServerConfig(workspace, name.trim(), config);
    return;
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      console.error(`\nFailed to connect: ${err}`);
      return;
    }
    // Auth required -- continue below
    console.log("  Authentication required.");
  }

  // Ask what type of auth
  console.log("\nAuthentication options:");
  console.log("  1. OAuth (browser-based authorization)");
  console.log("  2. API key / Bearer token");
  const authChoice = prompt("Choose auth method [1/2]:") ?? "1";

  if (authChoice.trim() === "2") {
    // Bearer token / API key auth
    const token = prompt("Enter your API key or Bearer token:") ?? "";
    if (!token.trim()) {
      console.error("Token is required.");
      return;
    }

    config.headers = { Authorization: `Bearer ${token.trim()}` };

    console.log("\nReconnecting with token...");
    try {
      const result = await detectTransport(serverUrl, {
        requestInit: { headers: config.headers },
      });
      config.transport = result.transport;
      console.log(`  Transport: ${result.transport}`);

      const { tools } = await result.client.listTools();
      console.log(`  Connected! Found ${tools.length} tool(s).`);
      for (const tool of tools) {
        console.log(
          `    - ${tool.name}: ${tool.description ?? "(no description)"}`,
        );
      }

      await result.client.close();
      await saveServerConfig(workspace, name.trim(), config);
    } catch (err) {
      console.error(`\nFailed to connect with token: ${err}`);
    }
    return;
  }

  // OAuth flow
  console.log("\nStarting OAuth authorization...");
  config.oauth = {};

  const oauthProvider = new ContainerclawOAuthProvider(
    name.trim(),
    workspace,
    config,
    (authUrl: URL) => {
      console.log(`\n  Opening browser for authorization...`);
      console.log(`  URL: ${authUrl.toString()}`);
      openBrowser(authUrl.toString());
    },
  );

  // Create transport with auth provider and attempt connection
  try {
    const transport = new StreamableHTTPClientTransport(serverUrl, {
      authProvider: oauthProvider,
    });
    const client = new Client({ name: "containerclaw", version: "1.0.0" });

    try {
      await client.connect(transport);
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;

      // OAuth redirect happened -- wait for callback
      console.log("  Waiting for authorization... (timeout: 120s)");
      const authCode = await waitForOAuthCallback();
      console.log("  Authorization code received!");

      // Complete the auth flow
      await transport.finishAuth(authCode);

      // Reconnect
      console.log("  Reconnecting with credentials...");
      const newTransport = new StreamableHTTPClientTransport(serverUrl, {
        authProvider: oauthProvider,
      });
      const newClient = new Client({
        name: "containerclaw",
        version: "1.0.0",
      });
      await newClient.connect(newTransport);

      const { tools } = await newClient.listTools();
      console.log(`\n  Connected! Found ${tools.length} tool(s).`);
      for (const tool of tools) {
        console.log(
          `    - ${tool.name}: ${tool.description ?? "(no description)"}`,
        );
      }
      await newClient.close();
    }

    config.transport = "streamable-http";
    await saveServerConfig(workspace, name.trim(), config);
  } catch (err) {
    console.error(`\nOAuth flow failed: ${err}`);
  }
}

async function saveServerConfig(
  workspace: string,
  name: string,
  config: MCPServerConfig,
): Promise<void> {
  const allServers = await loadMcpConfig(workspace);
  allServers[name] = config;
  await saveMcpConfig(workspace, allServers);
  const configPath = join(workspace, "mcp_servers.json");
  console.log(`\nSaved to ${configPath}`);
}
