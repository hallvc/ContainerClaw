# Channel Migration Guide

This document describes the chat channels supported by the original Python nanobot and the path to adding them to the Deno/TypeScript rewrite.

## Currently Implemented

### Slack
- **Status**: Implemented in MVP
- **Library**: `@slack/socket-mode` + `@slack/web-api` (npm)
- **File**: `src/channels/slack.ts`
- **Features**: Socket Mode, DM + group messaging, permission policies, thread-aware replies, :eyes: reactions, Markdown-to-mrkdwn conversion

## Not Yet Implemented

To add a new channel, implement the `BaseChannel` abstract class (`src/channels/base.ts`) and register it with the `ChannelManager`. Each channel must implement `start()`, `stop()`, and `send()`, and use `handleMessage()` to push inbound messages to the bus.

### Telegram
- **Python library**: `python-telegram-bot`
- **Deno equivalent**: `npm:telegraf` or `npm:grammy`
- **Effort**: Medium
- **Notes**: Both Telegraf and grammY have mature TypeScript SDKs. grammY is built with Deno in mind and has first-class Deno support. Supports long polling and webhooks. Media handling (photos, documents) maps well to the existing media array in `InboundMessage`.

### WhatsApp
- **Python library**: Custom Node.js bridge using `@whiskeysockets/baileys`
- **Deno equivalent**: `npm:@whiskeysockets/baileys` (direct, no bridge needed)
- **Effort**: Medium
- **Notes**: The Python version used a separate Node.js process as a bridge. In Deno, Baileys can be imported directly via npm: specifier, eliminating the bridge. Requires QR code authentication flow and session persistence. Multi-device support is built into Baileys.

### Discord
- **Python library**: Custom WebSocket implementation
- **Deno equivalent**: `npm:discord.js`
- **Effort**: Medium
- **Notes**: discord.js is the most mature Discord library. Supports slash commands, message components, and gateway events. The permission model maps well to the existing group policy system.

### Feishu / Lark
- **Python library**: `lark-oapi`
- **Deno equivalent**: Custom `fetch` wrapper to Feishu Open API
- **Effort**: High
- **Notes**: No mature TypeScript SDK exists. Would need to implement event subscription (webhook or long polling), message sending, and auth token management using raw HTTP calls to the Feishu API. Consider creating a thin Feishu client class.

### DingTalk
- **Python library**: `dingtalk-stream`
- **Deno equivalent**: Custom `fetch` wrapper + WebSocket for stream mode
- **Effort**: High
- **Notes**: DingTalk's stream mode uses a WebSocket connection for receiving events. No TypeScript SDK available. Would need to implement the stream protocol, message handling, and the DingTalk API for sending responses.

### Mochat
- **Python library**: `python-socketio`
- **Deno equivalent**: `npm:socket.io-client`
- **Effort**: Medium
- **Notes**: socket.io-client works well via npm: specifier in Deno. The Mochat protocol is Socket.IO-based, so the implementation is straightforward. Requires the Mochat server URL and authentication credentials.

### Email (IMAP/SMTP)
- **Python library**: stdlib `imaplib` + `smtplib`
- **Deno equivalent**: `npm:nodemailer` (SMTP) + `npm:imapflow` (IMAP)
- **Effort**: Medium
- **Notes**: nodemailer handles SMTP sending. imapflow provides a modern async IMAP client. Would need to poll for new emails on an interval and parse email bodies. HTML-to-text conversion can reuse the existing `@mozilla/readability` + `linkedom` setup.

### QQ
- **Python library**: `qq-botpy`
- **Deno equivalent**: Custom `fetch` wrapper to QQ Bot API
- **Effort**: High
- **Notes**: No TypeScript SDK for QQ bots. Would need to implement the QQ Bot HTTP API for sending/receiving messages, plus WebSocket for event subscription. QQ's API has specific authentication requirements (AppID + Token).

## Adding a New Channel

1. Create `src/channels/<name>.ts` implementing `BaseChannel`
2. Add any required config to `src/config/schema.ts` (Zod schema)
3. Add env var loading to `src/config/loader.ts`
4. Register the channel in `src/main.ts` (conditionally, based on config)
5. Add env vars to `docker-compose.yml`
6. Write tests in `src/channels/<name>_test.ts`
