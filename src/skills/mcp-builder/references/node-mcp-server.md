# TypeScript MCP Server Reference

## Project Setup

```bash
mkdir my-mcp-server && cd my-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node
npx tsc --init
```

`tsconfig.json` essentials:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  }
}
```

## Server Structure

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

// Register tools
server.tool("tool_name", "Description", { /* schema */ }, async (params) => {
  // implementation
  return { content: [{ type: "text", text: "result" }] };
});

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Tool Registration

### Basic tool

```typescript
server.tool(
  "greet",
  "Greet a user by name",
  { name: z.string().describe("Name to greet") },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }]
  })
);
```

### Tool with complex schema

```typescript
server.tool(
  "search_issues",
  "Search GitHub issues",
  {
    query: z.string().describe("Search keywords"),
    repo: z.string().describe("Repository in owner/repo format"),
    state: z.enum(["open", "closed", "all"]).default("open"),
    labels: z.array(z.string()).optional().describe("Filter by labels"),
    limit: z.number().min(1).max(100).default(20),
  },
  async ({ query, repo, state, labels, limit }) => {
    const results = await searchIssues(repo, query, state, labels, limit);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);
```

### Tool with error handling

```typescript
server.tool("get_user", "Get user by ID", { id: z.string() }, async ({ id }) => {
  try {
    const user = await api.getUser(id);
    if (!user) {
      return {
        content: [{ type: "text", text: `User '${id}' not found` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(user, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error fetching user: ${err.message}` }],
      isError: true,
    };
  }
});
```

## Resources (Optional)

```typescript
server.resource(
  "config",
  "config://app",
  "Application configuration",
  async () => ({
    contents: [{
      uri: "config://app",
      mimeType: "application/json",
      text: JSON.stringify(config),
    }]
  })
);
```

## Prompts (Optional)

```typescript
server.prompt(
  "summarize",
  "Summarize a document",
  { url: z.string().describe("URL to summarize") },
  async ({ url }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `Please summarize: ${url}` },
    }]
  })
);
```

## HTTP Transport

```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000, () => console.log("MCP server on http://localhost:3000/mcp"));
```

## Building and Running

```bash
# Build
npx tsc

# Run (stdio)
node dist/index.js

# Test with inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

## Package.json

```json
{
  "name": "my-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "my-mcp-server": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "inspect": "npx @modelcontextprotocol/inspector node dist/index.js"
  }
}
```
