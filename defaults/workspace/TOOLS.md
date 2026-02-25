# Available Tools

This document describes the tools available to containerclaw.

## File Operations

### read_file
Read the contents of a file.
```
read_file(path: str) -> str
```

### write_file
Write content to a file (creates parent directories if needed).
```
write_file(path: str, content: str) -> str
```

### edit_file
Edit a file by replacing specific text.
```
edit_file(path: str, old_text: str, new_text: str) -> str
```

### list_dir
List contents of a directory.
```
list_dir(path: str) -> str
```

## Shell Execution

### exec
Execute a shell command and return output.
```
exec(command: str, working_dir: str = None) -> str
```

**Safety Notes:**
- Commands have a configurable timeout (default 60s)
- Dangerous commands are blocked (rm -rf, format, dd, shutdown, etc.)
- Output is truncated at 10,000 characters
- Optional `restrictToWorkspace` config to limit paths

## Web Access

### web_search_exa
Search the web using [Exa](https://exa.ai/) (provided via MCP, enabled by default).
```
web_search_exa(query: str) -> str
```

Returns search results with titles, URLs, and content. No API key required (free tier). Additional Exa tools like `get_code_context_exa` and `company_research_exa` are also available.

### web_fetch
Fetch and extract main content from a URL.
```
web_fetch(url: str, extractMode: str = "markdown", maxChars: int = 50000) -> str
```

**Notes:**
- Content is extracted using readability
- Supports markdown or plain text extraction
- Output is truncated at 50,000 characters by default

## Communication

### message
Send a message to the user (used internally).
```
message(content: str, channel: str = None, chat_id: str = None) -> str
```

## Background Tasks

### spawn
Spawn a subagent to handle a task in the background.
```
spawn(task: str, label: str = None) -> str
```

Use for complex or time-consuming tasks that can run independently. The subagent will complete the task and report back when done.

## Scheduled Reminders (Cron)

Use the `exec` tool to create scheduled reminders with `containerclaw cron add`:

### Set a recurring reminder
```bash
# Every day at 9am
containerclaw cron add --name "morning" --message "Good morning! ☀️" --cron "0 9 * * *"

# Every 2 hours
containerclaw cron add --name "water" --message "Drink water! 💧" --every 7200
```

### Set a one-time reminder
```bash
# At a specific time (ISO format)
containerclaw cron add --name "meeting" --message "Meeting starts now!" --at "2025-01-31T15:00:00"
```

### Manage reminders
```bash
containerclaw cron list              # List all jobs
containerclaw cron remove <job_id>   # Remove a job
```

## Heartbeat Task Management

The `HEARTBEAT.md` file in the workspace is checked every 30 minutes.
Use file operations to manage periodic tasks:

### Add a heartbeat task
```python
# Append a new task
edit_file(
    path="HEARTBEAT.md",
    old_text="## Example Tasks",
    new_text="- [ ] New periodic task here\n\n## Example Tasks"
)
```

### Remove a heartbeat task
```python
# Remove a specific task
edit_file(
    path="HEARTBEAT.md",
    old_text="- [ ] Task to remove\n",
    new_text=""
)
```

### Rewrite all tasks
```python
# Replace the entire file
write_file(
    path="HEARTBEAT.md",
    content="# Heartbeat Tasks\n\n- [ ] Task 1\n- [ ] Task 2\n"
)
```

## MCP Server Management

MCP (Model Context Protocol) servers extend your capabilities with additional tools. Servers can be **remote** (URL-based, connect over HTTP) or **local** (subprocess via stdio).

**IMPORTANT:** When a user provides a URL like `https://example.com/mcp`, this is a **remote MCP endpoint to connect to** — do NOT install packages, pip install, or download code. Use `containerclaw mcp-add` to connect.

### Add a remote MCP server

```bash
# Interactive (prompts for name, URL, and auth)
containerclaw mcp-add

# Non-interactive (no auth)
containerclaw mcp-add --name "granola" --url "https://mcp.granola.ai/mcp"

# Non-interactive with Bearer token
containerclaw mcp-add --name "myapi" --url "https://api.example.com/mcp" --auth token --token "sk-xxx"
```

The command auto-detects the transport (Streamable HTTP or SSE), handles authentication, lists discovered tools, and saves the config. Use `--auth token --token <value>` for API key auth, or `--auth oauth` for browser-based OAuth.

### Manual configuration

Servers are stored in `mcp_servers.json` in the workspace directory. Edit with `exec` or file tools:

```json
{
  "my-server": {
    "url": "https://example.com/mcp"
  },
  "authed-server": {
    "url": "https://api.example.com/mcp",
    "headers": { "Authorization": "Bearer YOUR_TOKEN" }
  }
}
```

### List connected servers

MCP tools appear with the prefix `mcp_<servername>_<toolname>`. Check your available tools to see connected servers.

---

## Progress Updates

For multi-step tasks (2+ tool-call iterations), the system automatically sends a "Working on this" message to the user so they know work is in progress. After that initial signal, you will receive a system instruction asking you to use the `message` tool to send a brief plan summary (2-3 sentences) before continuing.

- Send the plan summary promptly — the user is waiting for feedback
- Keep it concise: what you're doing and why
- Then continue executing normally

Progress updates can be disabled via `agents.progress_updates: false` in config.

---

## Adding Custom Tools

To add custom tools:
1. Create a class that extends `Tool` in `src/agent/tools/`
2. Implement `name`, `description`, `parameters`, and `execute`
3. Register it in `AgentLoop._register_default_tools()`
