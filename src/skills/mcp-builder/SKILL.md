---
name: mcp-builder
description: "Build MCP (Model Context Protocol) servers that extend agent capabilities with custom tools. Use when the user wants to create an MCP server, add tools to an MCP server, or integrate an external API as MCP tools."
---

# Building MCP Servers

MCP servers expose tools that agents can call. This skill covers the full lifecycle from design to deployment.

## Phase 1: Design

Before writing code, define the tool surface:

1. **What API/service are you wrapping?** Read the API docs thoroughly.
2. **What tools should exist?** Each tool = one clear action. Name them as `verb_noun` (e.g., `get_user`, `create_issue`, `search_docs`).
3. **What inputs does each tool need?** Define schemas with clear descriptions.
4. **What does success/failure look like?** Define output format and error messages.

### Tool design principles

- **One tool, one action** -- avoid multi-purpose tools with mode switches
- **Descriptive names** -- agents pick tools by name and description
- **Rich descriptions** -- explain when to use this tool, what it returns, and edge cases
- **Input validation** -- validate all inputs with schemas before calling the API
- **Actionable errors** -- "User not found (id: 123)" > "404 error"

## Phase 2: Implementation

Choose TypeScript (recommended) or Python.

### TypeScript quick start

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

server.tool(
  "get_user",
  "Look up a user by ID. Returns name, email, and role.",
  { user_id: z.string().describe("The user's unique ID") },
  async ({ user_id }) => {
    const user = await fetchUser(user_id);
    return {
      content: [{ type: "text", text: JSON.stringify(user, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

Install: `npm install @modelcontextprotocol/sdk zod`

### Python quick start

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def get_user(user_id: str) -> str:
    """Look up a user by ID. Returns name, email, and role."""
    user = fetch_user(user_id)
    return json.dumps(user, indent=2)

mcp.run()
```

Install: `pip install mcp`

## Phase 3: Testing

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

The Inspector provides a web UI to call tools interactively and inspect responses.

### Test with stdio

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

### What to verify

- All tools appear in `tools/list` response
- Each tool returns correct output for valid inputs
- Invalid inputs produce clear error messages (not crashes)
- Long-running operations handle timeouts gracefully

## Phase 4: Deployment

### stdio transport (local)

Add to ContainerClaw's `mcp_servers.json`:

```json
{
  "my-server": {
    "command": "node",
    "args": ["/path/to/dist/index.js"],
    "env": { "API_KEY": "..." }
  }
}
```

### Streamable HTTP transport (remote)

For remote deployment, use the Streamable HTTP transport:

```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});
app.listen(3000);
```

Then add to ContainerClaw:

```bash
containerclaw mcp-add --name "my-server" --url "http://localhost:3000/mcp"
```

## References

- [references/mcp-best-practices.md](references/mcp-best-practices.md) -- tool annotation, error handling, context management
- [references/node-mcp-server.md](references/node-mcp-server.md) -- complete TypeScript reference
- [references/python-mcp-server.md](references/python-mcp-server.md) -- complete Python reference
