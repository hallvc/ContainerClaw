# nanobot (Deno)

An ultra-lightweight personal AI agent framework — a **Deno/TypeScript rewrite** of [nanobot](https://github.com/HKUDS/nanobot).

Delivers core agent functionality with tool execution, multi-channel chat, MCP support, persistent memory, and background subagents.

## Quick Start

**Prerequisites:** [Deno](https://deno.com/) 2.1.4+ and an [OpenRouter](https://openrouter.ai/keys) API key.

**1. Clone and initialize**

```bash
git clone <repo-url>
cd nanobot
deno task onboard
```

**2. Configure** (`~/.nanobot/config.json`)

```json
{
  "openrouter": {
    "api_key": "sk-or-v1-xxx",
    "default_model": "anthropic/claude-sonnet-4-20250514"
  }
}
```

**3. Chat**

```bash
deno task agent
```

That's it — a working AI assistant in under a minute.

## Key Features

- **Ultra-lightweight** — Core agent in ~4,600 lines of TypeScript
- **Multi-channel** — Slack, Telegram, and Email integrations
- **Tool execution** — File ops, shell commands, web search/fetch — all sandboxed to the workspace
- **MCP support** — Connect external tool servers via stdio or HTTP
- **Skills system** — Teach the agent new capabilities with markdown files
- **Subagents** — Spawn background tasks for parallel work
- **Persistent memory** — Automatic conversation summarization and long-term recall
- **Model roles** — Use different models for chat, memory consolidation, and general tasks

## CLI Reference

| Command | Description |
|---------|-------------|
| `deno task agent` | Interactive chat mode |
| `deno task agent -- -m "Hello"` | Send a single message |
| `deno task gateway` | Start the multi-channel gateway |
| `deno task status` | Show configuration status |
| `deno task onboard` | Initialize config and workspace |

Interactive mode exits: `exit`, `quit`, `/exit`, `/quit`, `:q`, or `Ctrl+D`.

Session management: `/new` clears the session, `/help` shows available commands.

### Development Tasks

| Task | Description |
|------|-------------|
| `deno task dev` | Run with `--watch` for live reload |
| `deno task test` | Run tests |
| `deno task lint` | Lint source |
| `deno task fmt` | Format source |

## Configuration

Config file: `~/.nanobot/config.json`

### Provider (OpenRouter)

```json
{
  "openrouter": {
    "api_key": "sk-or-v1-xxx",
    "default_model": "minimax/minimax-m2.5"
  }
}
```

The LLM provider is [OpenRouter](https://openrouter.ai), which gives access to models from Anthropic, OpenAI, Google, Meta, DeepSeek, and others through a single API key.

### Agent Settings

```json
{
  "agents": {
    "models": {
      "default": "anthropic/claude-sonnet-4-20250514",
      "chat": "deepseek/deepseek-r1",
      "memory": "anthropic/claude-haiku-4-5-20251001"
    },
    "temperature": 0.7,
    "max_tokens": 4096,
    "memory_window": 50,
    "max_iterations": 20
  }
}
```

**Model roles:**
- `default` — Fallback model for all tasks
- `chat` — Used for conversation (supports reasoning/thinking models)
- `memory` — Used for memory consolidation (a lightweight model works well)

### Web Search

Optionally enable web search with a [Brave Search](https://brave.com/search/api/) API key:

```json
{
  "web_search": {
    "brave_api_key": "BSA-xxx"
  }
}
```

### Full Config Reference

| Key | Default | Description |
|-----|---------|-------------|
| `openrouter.api_key` | `""` | OpenRouter API key |
| `openrouter.default_model` | `"minimax/minimax-m2.5"` | Default LLM model |
| `agents.temperature` | `0.7` | Sampling temperature (0-2) |
| `agents.max_tokens` | `4096` | Max response tokens |
| `agents.memory_window` | `50` | Messages before memory consolidation |
| `agents.max_iterations` | `20` | Max tool-call iterations per turn |
| `tools.exec_timeout_ms` | `60000` | Shell command timeout (ms) |
| `workspace` | `"/workspace"` | Agent workspace directory |
| `data_dir` | `"/data"` | Data storage directory |

## Chat Channels

Start all enabled channels with:

```bash
deno task gateway
```

### Slack

Uses Socket Mode — no public URL required.

**1. Create a Slack app** at [api.slack.com/apps](https://api.slack.com/apps)

- **Socket Mode:** Toggle ON, generate an App-Level Token (`xapp-...`) with `connections:write` scope
- **OAuth & Permissions:** Add bot scopes: `chat:write`, `reactions:write`, `app_mentions:read`
- **Event Subscriptions:** Toggle ON, subscribe to: `message.im`, `message.channels`, `app_mention`
- **App Home:** Enable Messages Tab, allow users to send messages
- **Install** to workspace, copy Bot Token (`xoxb-...`)

**2. Configure**

```json
{
  "slack": {
    "bot_token": "xoxb-...",
    "app_token": "xapp-...",
    "group_policy": "mention"
  }
}
```

`group_policy`: `"mention"` (respond when @mentioned), `"open"` (respond to all), or `"allowlist"`.

### Telegram

**1. Create a bot** via `@BotFather` on Telegram and copy the token.

**2. Configure**

```json
{
  "telegram": {
    "bot_token": "YOUR_BOT_TOKEN",
    "allow_from": ["YOUR_USER_ID"]
  }
}
```

### Email

Uses the [AgentMail](https://agentmail.to) service for email integration.

```json
{
  "email": {
    "api_key": "YOUR_AGENTMAIL_API_KEY",
    "inbox_id": "YOUR_INBOX_ID",
    "username": "nanobot",
    "domain": "agentmail.to",
    "poll_interval_seconds": 15,
    "policy": "open",
    "allow_from": []
  }
}
```

## MCP (Model Context Protocol)

Connect external tool servers and use them as native agent tools. The config format is compatible with Claude Desktop / Cursor.

Add MCP servers to `{workspace}/mcp_servers.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "remote-tools": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

| Transport | Config | Use Case |
|-----------|--------|----------|
| **Stdio** | `command` + `args` | Local processes via `npx` / `uvx` |
| **HTTP** | `url` | Remote endpoints |

MCP tools are automatically discovered at startup and available to the LLM alongside built-in tools.

## Skills

Skills teach the agent new capabilities via markdown files in `{workspace}/skills/`.

Each skill is a `.md` file with optional YAML frontmatter:

```markdown
---
name: my-skill
description: Does something useful
requirements:
  binaries: [jq]
  env: [MY_API_KEY]
always: false
---

# My Skill

Instructions for the agent...
```

- `always: true` — Skill is loaded into every conversation
- `requirements` — The agent checks for required binaries and env vars before using the skill
- Skills are progressively loaded: the agent sees a summary and reads the full content on demand

Default skills (GitHub, weather, tmux, etc.) are seeded into the workspace on first run.

## Architecture

```
src/
├── main.ts                 # Entry point
├── agent/
│   ├── loop.ts             # Agent loop (LLM + tool execution)
│   ├── context.ts          # System prompt and message building
│   ├── memory.ts           # Persistent memory store
│   ├── skills.ts           # Skills loader
│   ├── subagent.ts         # Background agent spawning
│   └── tools/
│       ├── base.ts         # Tool interface and registry
│       ├── filesystem.ts   # read, write, edit, list (workspace-confined)
│       ├── shell.ts        # exec (with safety guards)
│       ├── web.ts          # web_search, web_fetch
│       ├── message.ts      # Send messages to channels
│       ├── cron.ts         # Schedule tasks
│       ├── spawn.ts        # Spawn subagents
│       └── mcp.ts          # MCP server integration
├── channels/
│   ├── base.ts             # Abstract channel interface
│   ├── manager.ts          # Channel lifecycle
│   ├── slack.ts            # Slack (Socket Mode)
│   ├── telegram.ts         # Telegram (grammy)
│   └── email.ts            # Email (AgentMail)
├── bus/                    # Async message routing
├── config/                 # Zod-validated configuration
├── providers/              # LLM providers (OpenRouter)
├── session/                # Conversation session management
├── cron/                   # Scheduled task execution
├── heartbeat/              # Proactive wake-up intervals
├── skills/                 # Bundled default skills
└── cli/                    # CLI commands
```

### How It Works

1. **Channels** receive messages from users and publish them to the **message bus**
2. The **agent loop** consumes messages, builds context (system prompt + history + skills + memory), and calls the LLM
3. The LLM responds with text and/or **tool calls** — the agent executes tools and feeds results back
4. This repeats until the LLM produces a final response (no more tool calls) or hits the iteration limit
5. The response is routed back through the bus to the originating channel
6. **Memory consolidation** kicks in when conversation length exceeds the configured window, summarizing older messages

## Docker

```bash
# Build
docker build -t nanobot .

# Initialize config (first time)
docker run -v ~/.nanobot:/root/.nanobot --rm nanobot run --allow-all src/main.ts onboard

# Run gateway
docker run -v ~/.nanobot:/root/.nanobot -p 18790:18790 nanobot

# Single message
docker run -v ~/.nanobot:/root/.nanobot --rm nanobot run --allow-all src/main.ts agent -m "Hello!"
```

## Security

- **Workspace confinement** is always enforced — all file operations and shell commands are restricted to the workspace directory. This is not configurable and cannot be disabled.
- **Channel allow lists** — Each channel supports an `allow_from` list to restrict which users can interact with the agent. Empty means allow all.
- **Shell safety guards** — The exec tool blocks dangerous patterns (`rm -rf /`, `dd`, `format`, `shutdown`, fork bombs, etc.).

## Customization

Place these optional files in your workspace to customize the agent's behavior:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Agent behavior and instructions |
| `SOUL.md` | Personality and character |
| `USER.md` | User preferences and context |
| `TOOLS.md` | Tool usage documentation |
| `IDENTITY.md` | Identity and role definition |

These are automatically loaded into the system prompt when present.

## License

MIT
