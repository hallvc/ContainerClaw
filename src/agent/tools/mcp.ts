/**
 * MCP client: connects to MCP servers and wraps their tools as native containerclaw tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { join } from "@std/path";
import type { Tool } from "./base.ts";
import { ToolRegistry } from "./base.ts";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { performOAuthFlow } from "./mcp_auth.ts";

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  transport?: "streamable-http" | "sse";
  oauth?: {
    tokens?: Record<string, unknown>;
    clientInformation?: Record<string, unknown>;
    codeVerifier?: string;
  };
}

/** Default MCP servers included out of the box. */
const DEFAULT_MCP_SERVERS: Record<string, MCPServerConfig> = {
  exa: { url: "https://mcp.exa.ai/mcp" },
};

/** Load MCP server config from {workspace}/mcp_servers.json, merged with defaults. */
export async function loadMcpConfig(
  workspace: string,
): Promise<Record<string, MCPServerConfig>> {
  try {
    const text = await Deno.readTextFile(join(workspace, "mcp_servers.json"));
    const user = JSON.parse(text);
    return { ...DEFAULT_MCP_SERVERS, ...user };
  } catch {
    return { ...DEFAULT_MCP_SERVERS };
  }
}

/** Save MCP server config to {workspace}/mcp_servers.json, excluding defaults. */
export async function saveMcpConfig(
  workspace: string,
  servers: Record<string, MCPServerConfig>,
): Promise<void> {
  const toSave: Record<string, MCPServerConfig> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    const defaultCfg = DEFAULT_MCP_SERVERS[name];
    if (defaultCfg && JSON.stringify(cfg) === JSON.stringify(defaultCfg)) {
      continue;
    }
    toSave[name] = cfg;
  }
  await Deno.writeTextFile(
    join(workspace, "mcp_servers.json"),
    JSON.stringify(toSave, null, 2) + "\n",
  );
}

// deno-lint-ignore no-explicit-any
type MCPClient = any;

/** Wraps a single MCP server tool as a containerclaw Tool. */
export class MCPToolWrapper implements Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  private _client: MCPClient;
  private _originalName: string;

  constructor(
    client: MCPClient,
    serverName: string,
    toolDef: {
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    },
  ) {
    this._client = client;
    this._originalName = toolDef.name;
    this.name = `mcp_${serverName}_${toolDef.name}`;
    this.description = toolDef.description || toolDef.name;
    this.parameters = toolDef.inputSchema ||
      { type: "object", properties: {} };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const result = await this._client.callTool({
      name: this._originalName,
      arguments: args,
    });
    const parts: string[] = [];
    for (const block of (result.content ?? [])) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      } else {
        parts.push(JSON.stringify(block));
      }
    }
    return parts.join("\n") || "(no output)";
  }
}

/** Build transport options for a URL-based server. */
function buildTransportOpts(
  cfg: MCPServerConfig,
  authProvider?: OAuthClientProvider,
): { requestInit?: RequestInit; authProvider?: OAuthClientProvider } {
  const opts: {
    requestInit?: RequestInit;
    authProvider?: OAuthClientProvider;
  } = {};
  if (cfg.headers && Object.keys(cfg.headers).length > 0) {
    opts.requestInit = { headers: { ...cfg.headers } };
  }
  if (authProvider) {
    opts.authProvider = authProvider;
  }
  return opts;
}

/** List and register tools from a connected MCP client. */
async function registerTools(
  client: MCPClient,
  serverName: string,
  registry: ToolRegistry,
): Promise<number> {
  const { tools } = await client.listTools();
  for (const toolDef of tools) {
    const wrapper = new MCPToolWrapper(client, serverName, toolDef);
    registry.register(wrapper);
    console.log(
      `MCP: registered tool '${wrapper.name}' from server '${serverName}'`,
    );
  }
  return tools.length;
}

/**
 * Attempt to connect a transport, handling OAuth authorization inline.
 * If the SDK throws UnauthorizedError and an authProvider is present,
 * waits for the browser OAuth callback and reconnects with new tokens.
 */
async function connectWithAuth(
  name: string,
  url: URL,
  opts: { requestInit?: RequestInit; authProvider?: OAuthClientProvider },
  createTransport: () => StreamableHTTPClientTransport | SSEClientTransport,
  registry: ToolRegistry,
): Promise<{ client: MCPClient; cleanup: () => Promise<void> }> {
  const transport = createTransport();
  const client = new Client({ name: "containerclaw", version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (err) {
    if (err instanceof UnauthorizedError && opts.authProvider) {
      // SDK did discovery + redirect; wait for browser callback
      console.log(
        `MCP server '${name}': authorization required, waiting for browser auth...`,
      );
      await performOAuthFlow(transport);
      console.log(`MCP server '${name}': authorization complete!`);

      // Reconnect with the now-valid tokens
      const newTransport = createTransport();
      const newClient = new Client({ name: "containerclaw", version: "1.0.0" });
      await newClient.connect(newTransport);
      await registerTools(newClient, name, registry);
      return { client: newClient, cleanup: () => newClient.close() };
    }
    throw err;
  }
  await registerTools(client, name, registry);
  return { client, cleanup: () => client.close() };
}

/**
 * Connect a URL-based MCP server with transport auto-detection.
 * Tries Streamable HTTP first, falls back to SSE on failure.
 * Handles OAuth authorization inline when an authProvider is present.
 */
async function connectUrlServer(
  name: string,
  cfg: MCPServerConfig,
  registry: ToolRegistry,
  authProvider?: OAuthClientProvider,
): Promise<{ client: MCPClient; cleanup: () => Promise<void> }> {
  const url = new URL(cfg.url!);
  const opts = buildTransportOpts(cfg, authProvider);

  // If transport is forced to SSE, use it directly
  if (cfg.transport === "sse") {
    return connectWithAuth(
      name, url, opts,
      () => new SSEClientTransport(url, opts),
      registry,
    );
  }

  // Try Streamable HTTP first
  try {
    return await connectWithAuth(
      name, url, opts,
      () => new StreamableHTTPClientTransport(url, opts),
      registry,
    );
  } catch (err) {
    // Don't fall back on auth errors -- those need user action or already handled
    if (err instanceof UnauthorizedError) throw err;

    // If transport was explicitly set, don't fall back
    if (cfg.transport === "streamable-http") throw err;

    // Fall back to SSE transport
    console.log(
      `MCP server '${name}': Streamable HTTP failed, trying SSE fallback...`,
    );
    return connectWithAuth(
      name, url, opts,
      () => new SSEClientTransport(url, opts),
      registry,
    );
  }
}

/** Connect to configured MCP servers and register their tools. */
export async function connectMcpServers(
  mcpServers: Record<string, MCPServerConfig>,
  registry: ToolRegistry,
  authProviders?: Record<string, OAuthClientProvider>,
): Promise<Array<() => Promise<void>>> {
  const cleanups: Array<() => Promise<void>> = [];

  for (const [name, cfg] of Object.entries(mcpServers)) {
    try {
      if (cfg.command) {
        // Stdio transport (local subprocess)
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          env: cfg.env,
        });
        const client = new Client({ name: "containerclaw", version: "1.0.0" });
        await client.connect(transport);
        const count = await registerTools(client, name, registry);
        console.log(
          `MCP server '${name}': connected, ${count} tools registered`,
        );
        cleanups.push(() => client.close());
      } else if (cfg.url) {
        // URL transport (remote server) with auto-detection and auth
        const authProvider = authProviders?.[name];
        const { cleanup } = await connectUrlServer(
          name,
          cfg,
          registry,
          authProvider,
        );
        cleanups.push(cleanup);
      } else {
        console.warn(
          `MCP server '${name}': no command or url configured, skipping`,
        );
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        console.error(
          `MCP server '${name}': authentication required. Run 'containerclaw mcp-add' to configure auth.`,
        );
      } else {
        console.error(`MCP server '${name}': failed to connect:`, err);
      }
    }
  }

  return cleanups;
}

export { UnauthorizedError };
