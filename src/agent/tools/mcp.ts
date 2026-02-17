/**
 * MCP client: connects to MCP servers and wraps their tools as native nanobot tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { join } from "@std/path";
import type { Tool } from "./base.ts";
import { ToolRegistry } from "./base.ts";

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/** Load MCP server config from {workspace}/mcp_servers.json. */
export async function loadMcpConfig(
  workspace: string,
): Promise<Record<string, MCPServerConfig>> {
  try {
    const text = await Deno.readTextFile(join(workspace, "mcp_servers.json"));
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// deno-lint-ignore no-explicit-any
type MCPClient = any;

/** Wraps a single MCP server tool as a nanobot Tool. */
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

/** Connect to configured MCP servers and register their tools. */
export async function connectMcpServers(
  mcpServers: Record<string, MCPServerConfig>,
  registry: ToolRegistry,
): Promise<Array<() => Promise<void>>> {
  const cleanups: Array<() => Promise<void>> = [];

  for (const [name, cfg] of Object.entries(mcpServers)) {
    try {
      let transport;
      if (cfg.command) {
        transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          env: cfg.env,
        });
      } else if (cfg.url) {
        transport = new StreamableHTTPClientTransport(new URL(cfg.url));
      } else {
        console.warn(
          `MCP server '${name}': no command or url configured, skipping`,
        );
        continue;
      }

      const client = new Client({ name: "nanobot", version: "1.0.0" });
      await client.connect(transport);

      const { tools } = await client.listTools();
      for (const toolDef of tools) {
        const wrapper = new MCPToolWrapper(client, name, toolDef);
        registry.register(wrapper);
        console.log(`MCP: registered tool '${wrapper.name}' from server '${name}'`);
      }

      console.log(
        `MCP server '${name}': connected, ${tools.length} tools registered`,
      );
      cleanups.push(() => client.close());
    } catch (err) {
      console.error(`MCP server '${name}': failed to connect:`, err);
    }
  }

  return cleanups;
}
