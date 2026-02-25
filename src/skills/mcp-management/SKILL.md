---
name: mcp-management
description: Add, configure, and troubleshoot MCP (Model Context Protocol) servers. Use when the user wants to install, connect, add, remove, or debug an MCP server, or when they provide a URL ending in /mcp. Triggers on: "install MCP", "add MCP server", "connect MCP", "MCP setup", "add this server", or any URL like https://example.com/mcp.
---

# MCP Server Management

## Critical Rule

When a user provides a URL (e.g. `https://mcp.granola.ai/mcp`), this is a **remote endpoint to connect to over HTTP**. Never install Python/Node packages, pip install, npm install, or download source code. Use `containerclaw mcp-add` to connect.

## Adding a Remote Server

### Quick method (CLI)

```bash
# No auth required
containerclaw mcp-add --name "server-name" --url "https://example.com/mcp"

# With Bearer token / API key
containerclaw mcp-add --name "server-name" --url "https://example.com/mcp" --auth token --token "sk-xxx"

# With OAuth (opens browser)
containerclaw mcp-add --name "server-name" --url "https://example.com/mcp" --auth oauth
```

The command:
1. Attempts connection (with auth if provided)
2. Auto-detects transport (Streamable HTTP first, SSE fallback)
3. Lists discovered tools
4. Saves to `mcp_servers.json`

When using `exec`, always pass `--name`, `--url`, and auth flags to avoid interactive prompts.

### Manual method (edit config directly)

Edit `mcp_servers.json` in the workspace directory:

```json
{
  "server-name": {
    "url": "https://example.com/mcp"
  }
}
```

With Bearer token auth:
```json
{
  "server-name": {
    "url": "https://example.com/mcp",
    "headers": { "Authorization": "Bearer TOKEN_HERE" }
  }
}
```

With explicit transport:
```json
{
  "server-name": {
    "url": "https://example.com/mcp",
    "transport": "sse"
  }
}
```

Servers are loaded on agent startup. After editing config manually, restart the agent to connect.

## Transport Types

| Transport | Config | Use case |
|---|---|---|
| Streamable HTTP | `"url": "https://..."` | Default for remote servers (tried first) |
| SSE | `"url": "https://...", "transport": "sse"` | Legacy remote servers |
| Stdio | `"command": "node", "args": ["server.js"]` | Local subprocess servers |

## Authentication

- **No auth**: Most public MCP servers work without credentials
- **Bearer token**: Set `headers.Authorization` in config
- **OAuth 2.1**: Handled by `containerclaw mcp-add` (opens browser, PKCE flow, tokens saved automatically)

## Removing a Server

Edit `mcp_servers.json` and remove the server entry. The `exa` server is a built-in default and doesn't appear in the config file.

## Troubleshooting

- **"Authentication required"**: Run `containerclaw mcp-add` to set up OAuth or add a Bearer token
- **Connection timeout**: Verify the URL is reachable with `web_fetch`
- **Transport mismatch**: Try setting `"transport": "sse"` explicitly if Streamable HTTP fails
- **Tools not appearing**: Restart the agent after config changes; tools are prefixed `mcp_<servername>_<toolname>`
