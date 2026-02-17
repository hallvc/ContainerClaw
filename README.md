# nanobot (Deno)

An ultra-lightweight personal AI agent framework — a **Deno/TypeScript rewrite** of [nanobot](https://github.com/HKUDS/nanobot).

Delivers core agent functionality with tool execution, multi-channel chat, MCP support, persistent memory, and background subagents.

## Quick Start

**Prerequisites:** [Deno](https://deno.com/) 2.6+ and an [OpenRouter](https://openrouter.ai/keys) API key.

**1. Clone and initialize**

```bash
git clone <repo-url>
cd nanobot
deno task onboard
```

**2. Configure** (`~/.nanobot/data/.env`)

```bash
OPENROUTER_API_KEY=sk-or-v1-xxx
```

Or copy the example and fill in your values:

```bash
cp .env.example ~/.nanobot/data/.env
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

Configuration is loaded from three sources, with later sources overriding earlier ones:

1. **`config.json`** — Non-secret settings (models, tuning, paths)
2. **`.env` file** — Secrets and overrides (API keys, tokens)
3. **Shell environment variables** — Always win over both files

The `.env` file is loaded from the same directory as `config.json`. By default, `deno task onboard` writes `config.json` to `~/.nanobot/data/` and secrets to `~/.nanobot/data/.env`.

### Environment Variables

All settings can be configured via environment variables. A `.env.example` is included in the project root.

```bash
# Required
OPENROUTER_API_KEY=sk-or-v1-xxx

# Model selection (optional)
NANOBOT_MODEL=anthropic/claude-sonnet-4-20250514
NANOBOT_MODEL_CHAT=deepseek/deepseek-r1
NANOBOT_MODEL_MEMORY=anthropic/claude-haiku-4-5-20251001

# Agent tuning (optional)
NANOBOT_TEMPERATURE=0.7
NANOBOT_MAX_TOKENS=4096
NANOBOT_MEMORY_WINDOW=50
NANOBOT_MAX_ITERATIONS=20

# Channels (optional)
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
TELEGRAM_BOT_TOKEN=...
AGENTMAIL_API_KEY=...
```

### Provider (OpenRouter)

The LLM provider is [OpenRouter](https://openrouter.ai), which gives access to models from Anthropic, OpenAI, Google, Meta, DeepSeek, and others through a single API key.

Set the API key via environment variable (`OPENROUTER_API_KEY`) or in `config.json`:

```json
{
  "openrouter": {
    "default_model": "minimax/minimax-m2.5"
  }
}
```

### Agent Settings

Configure via environment variables (see above) or `config.json`:

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

Web search is provided by [Exa](https://exa.ai/) via MCP and is enabled by default — no API key required. The agent automatically connects to Exa's hosted MCP server and gains access to `web_search_exa` and other search tools.

To use your own Exa API key for higher rate limits, configure the Exa MCP server in `mcp_servers.json`:

```json
{
  "exa": {
    "url": "https://mcp.exa.ai/mcp?exaApiKey=YOUR_KEY"
  }
}
```

### Full Config Reference

| Setting | Env Variable | Default | Description |
|---------|-------------|---------|-------------|
| `openrouter.api_key` | `OPENROUTER_API_KEY` | `""` | OpenRouter API key |
| `openrouter.default_model` | `NANOBOT_MODEL` | `"minimax/minimax-m2.5"` | Default LLM model |
| `agents.models.chat` | `NANOBOT_MODEL_CHAT` | — | Chat model override |
| `agents.models.memory` | `NANOBOT_MODEL_MEMORY` | — | Memory consolidation model |
| `agents.temperature` | `NANOBOT_TEMPERATURE` | `0.7` | Sampling temperature (0-2) |
| `agents.max_tokens` | `NANOBOT_MAX_TOKENS` | `4096` | Max response tokens |
| `agents.memory_window` | `NANOBOT_MEMORY_WINDOW` | `50` | Messages before memory consolidation |
| `agents.max_iterations` | `NANOBOT_MAX_ITERATIONS` | `20` | Max tool-call iterations per turn |
| `tools.exec_timeout_ms` | — | `60000` | Shell command timeout (ms) |
| `workspace` | `NANOBOT_WORKSPACE` | `"/workspace"` | Agent workspace directory |
| `data_dir` | `NANOBOT_DATA_DIR` | `"/data"` | Data storage directory |

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

**2. Configure** (via `.env` or `config.json`)

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_GROUP_POLICY=mention
```

`group_policy`: `"mention"` (respond when @mentioned), `"open"` (respond to all), or `"allowlist"`.

### Telegram

**1. Create a bot** via `@BotFather` on Telegram and copy the token.

**2. Configure** (via `.env` or `config.json`)

```bash
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
TELEGRAM_ALLOW_FROM=USER_ID_1,USER_ID_2
```

### Email

Uses the [AgentMail](https://agentmail.to) service for email integration.

```bash
AGENTMAIL_API_KEY=YOUR_AGENTMAIL_API_KEY
AGENTMAIL_INBOX_ID=YOUR_INBOX_ID
AGENTMAIL_USERNAME=nanobot
AGENTMAIL_DOMAIN=agentmail.to
AGENTMAIL_POLL_INTERVAL=15
AGENTMAIL_POLICY=open
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

# Run with docker-compose (reads .env automatically)
docker compose up

# Or run directly with env vars
docker run --env-file .env -v nanobot-data:/data -v nanobot-workspace:/workspace nanobot

# Single message
docker run --env-file .env --rm nanobot run --allow-all src/main.ts agent -m "Hello!"
```

The included `docker-compose.yml` passes all supported environment variables into the container. Place your `.env` file in the project root or export the variables in your shell.

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
