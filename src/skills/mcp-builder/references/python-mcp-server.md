# Python MCP Server Reference

## Project Setup

```bash
mkdir my-mcp-server && cd my-mcp-server
pip install mcp
```

## Server Structure (FastMCP)

```python
from mcp.server.fastmcp import FastMCP
import json

mcp = FastMCP("my-server")

@mcp.tool()
def tool_name(param: str) -> str:
    """Tool description for the agent."""
    return json.dumps({"result": "value"})

# Run with stdio transport
mcp.run()
```

## Tool Registration

### Basic tool

```python
@mcp.tool()
def greet(name: str) -> str:
    """Greet a user by name."""
    return f"Hello, {name}!"
```

### Tool with complex parameters

```python
from typing import Optional

@mcp.tool()
def search_issues(
    query: str,
    repo: str,
    state: str = "open",
    labels: Optional[list[str]] = None,
    limit: int = 20,
) -> str:
    """Search GitHub issues by keyword, label, or state.

    Args:
        query: Search keywords to match against issue title and body
        repo: Repository in owner/repo format
        state: Filter by state (open, closed, all). Default: open
        labels: Optional list of labels to filter by
        limit: Maximum results to return (1-100). Default: 20
    """
    results = search(repo, query, state, labels, limit)
    return json.dumps(results, indent=2)
```

### Tool with error handling

```python
@mcp.tool()
def get_user(user_id: str) -> str:
    """Look up a user by their unique ID. Returns name, email, and role."""
    try:
        user = api.get_user(user_id)
        if not user:
            return json.dumps({"error": f"User '{user_id}' not found"})
        return json.dumps(user, indent=2)
    except Exception as e:
        return json.dumps({"error": f"Failed to fetch user: {str(e)}"})
```

## Resources (Optional)

```python
@mcp.resource("config://app")
def get_config() -> str:
    """Application configuration."""
    return json.dumps(config, indent=2)
```

## Prompts (Optional)

```python
@mcp.prompt()
def summarize(url: str) -> str:
    """Generate a prompt to summarize a URL."""
    return f"Please summarize the content at: {url}"
```

## HTTP Transport

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-server")

# ... register tools ...

# Run with HTTP transport
mcp.run(transport="streamable-http", host="0.0.0.0", port=3000)
```

## Low-Level Server (Without FastMCP)

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
import json

server = Server("my-server")

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="greet",
            description="Greet a user by name",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name to greet"}
                },
                "required": ["name"],
            },
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "greet":
        return [TextContent(type="text", text=f"Hello, {arguments['name']}!")]
    raise ValueError(f"Unknown tool: {name}")

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

import asyncio
asyncio.run(main())
```

## Running

```bash
# stdio transport (default)
python server.py

# HTTP transport
python server.py --transport streamable-http --port 3000

# Test with inspector
npx @modelcontextprotocol/inspector python server.py
```

## Project Structure

```
my-mcp-server/
├── server.py          # Main server with tool definitions
├── tools/             # Tool implementations (for larger servers)
│   ├── __init__.py
│   ├── users.py
│   └── issues.py
├── requirements.txt   # mcp
└── README.md
```
