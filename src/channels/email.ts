/**
 * Email channel implementation using the AgentMail platform.
 */

import { AgentMailClient } from "agentmail";

import type { OutboundMessage } from "../bus/events.ts";
import type { MessageBus } from "../bus/queue.ts";
import { BaseChannel } from "./base.ts";

export interface EmailChannelConfig {
  apiKey: string;
  inboxId: string;
  username: string;
  domain: string;
  pollIntervalSeconds: number;
  policy: "open" | "allowlist";
  allowFrom: string[];
  dataDir: string;
}

export class EmailChannel extends BaseChannel {
  readonly name = "email";

  private config: EmailChannelConfig;
  private client: AgentMailClient | null = null;
  private inboxId: string | null = null;
  private inboxAddress: string | null = null;
  private lastPollTimestamp: Date | null = null;
  private seenMessageIds: Set<string> = new Set();

  constructor(config: EmailChannelConfig, bus: MessageBus) {
    super(bus);
    this.config = config;
  }

  async start(): Promise<void> {
    this._running = true;

    this.client = new AgentMailClient({ apiKey: this.config.apiKey });

    // Resolve or create inbox
    this.inboxId = await this.resolveInbox();
    console.log(
      `Email channel connected: inbox=${this.inboxId} address=${this.inboxAddress}`,
    );

    // Initialize poll timestamp to now (only process new messages)
    this.lastPollTimestamp = new Date();

    // Polling loop (analogous to Slack socket event listener)
    while (this._running) {
      try {
        await this.pollMessages();
      } catch (e) {
        console.error(`Email poll error: ${e}`);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.pollIntervalSeconds * 1000)
      );
    }
  }

  stop(): Promise<void> {
    this._running = false;
    this.client = null;
    return Promise.resolve();
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.client || !this.inboxId) {
      console.warn("Email client not running");
      return;
    }

    try {
      const emailMeta = (msg.metadata?.email ?? {}) as Record<string, unknown>;
      const messageId = emailMeta.messageId as string | undefined;
      const subject = emailMeta.subject as string | undefined;

      const htmlContent = this.textToHtml(msg.content);

      if (messageId) {
        // Reply to existing thread
        await this.client.inboxes.messages.reply(this.inboxId, messageId, {
          text: msg.content,
          html: htmlContent,
        });
      } else {
        // New message (e.g., from cron job)
        await this.client.inboxes.messages.send(this.inboxId, {
          to: [msg.chatId],
          subject: subject ?? "Message from assistant",
          text: msg.content,
          html: htmlContent,
        });
      }
    } catch (e) {
      console.error(`Error sending email: ${e}`);
    }
  }

  private async resolveInbox(): Promise<string> {
    // 1. If inbox_id is configured, use it directly
    if (this.config.inboxId) {
      const inbox = await this.client!.inboxes.get(this.config.inboxId);
      const inboxData = inbox as unknown as Record<string, unknown>;
      this.inboxAddress = (inboxData.email as string) ?? this.config.inboxId;
      return this.config.inboxId;
    }

    // 2. Check persisted inbox ID from previous run
    const persistPath = `${this.config.dataDir}/email_inbox.json`;
    try {
      const text = await Deno.readTextFile(persistPath);
      const saved = JSON.parse(text);
      if (saved.inboxId) {
        try {
          await this.client!.inboxes.get(saved.inboxId);
          this.inboxAddress = saved.address ?? saved.inboxId;
          return saved.inboxId;
        } catch {
          // Inbox no longer exists, fall through to create
        }
      }
    } catch {
      // No persisted file, fall through to create
    }

    // 3. Auto-create inbox
    const createReq: Record<string, unknown> = {};
    if (this.config.username) createReq.username = this.config.username;
    if (this.config.domain) createReq.domain = this.config.domain;

    const inbox = await this.client!.inboxes.create(createReq);
    const inboxData = inbox as unknown as Record<string, unknown>;
    const inboxId = inboxData.inboxId as string;
    this.inboxAddress = `${this.config.username || inboxId}@${
      this.config.domain || "agentmail.to"
    }`;

    // Persist for restarts
    try {
      await Deno.writeTextFile(
        persistPath,
        JSON.stringify({ inboxId, address: this.inboxAddress }),
      );
    } catch (e) {
      console.warn(`Failed to persist email inbox ID: ${e}`);
    }

    return inboxId;
  }

  private async pollMessages(): Promise<void> {
    if (!this.client || !this.inboxId) return;

    const response = await this.client.inboxes.messages.list(this.inboxId);

    const messages = (response as unknown as Record<string, unknown>)
      .messages as
        | Record<string, unknown>[]
        | undefined;

    for (const msgItem of messages ?? []) {
      const msgTimestamp = new Date(msgItem.timestamp as string);

      // Skip messages older than our last poll (use continue, not break,
      // because the API may not return messages in descending order)
      if (this.lastPollTimestamp && msgTimestamp <= this.lastPollTimestamp) {
        continue;
      }

      const msgId = msgItem.messageId as string;

      // Deduplicate by message ID
      if (this.seenMessageIds.has(msgId)) {
        continue;
      }
      this.seenMessageIds.add(msgId);

      // Fetch full message for text/html content
      const fullMsg = await this.client.inboxes.messages.get(
        this.inboxId,
        msgId,
      );

      await this.processInboundMessage(
        fullMsg as unknown as Record<string, unknown>,
      );
    }

    // Prune seen IDs set to prevent unbounded growth (keep last 500)
    if (this.seenMessageIds.size > 500) {
      const arr = [...this.seenMessageIds];
      this.seenMessageIds = new Set(arr.slice(arr.length - 500));
    }

    this.lastPollTimestamp = new Date();
  }

  private async processInboundMessage(
    msg: Record<string, unknown>,
  ): Promise<void> {
    const senderAddress = this.extractSenderAddress(msg.from as string);
    if (!senderAddress) return;

    // Skip messages sent by our own inbox (avoid echo)
    if (this.inboxAddress && senderAddress === this.inboxAddress) return;

    // Permission check
    if (!this.isAllowed(senderAddress)) return;

    // Extract text content (prefer extractedText > text > stripped html)
    const content = this.extractContent(msg);
    if (!content.trim()) return;

    const threadId = msg.threadId as string;
    const messageId = msg.messageId as string;
    const subject = (msg.subject as string) ?? "";

    // Prepend subject for context if present
    const fullContent = subject
      ? `[Subject: ${subject}]\n\n${content}`
      : content;

    console.debug(
      `Email received: from=${senderAddress} thread=${threadId} subject=${
        subject.slice(0, 60)
      }`,
    );

    await this.handleMessage({
      senderId: senderAddress,
      chatId: threadId,
      content: fullContent,
      metadata: {
        email: {
          messageId,
          threadId,
          subject,
          from: msg.from,
          to: msg.to,
        },
      },
    });
  }

  private isAllowed(senderAddress: string): boolean {
    if (this.config.policy === "open") return true;
    if (this.config.policy === "allowlist") {
      return this.config.allowFrom.some(
        (addr) => addr.toLowerCase() === senderAddress.toLowerCase(),
      );
    }
    return false;
  }

  /** Extracts email address from "Display Name <email@domain>" or plain "email@domain" format. */
  private extractSenderAddress(from: string | undefined): string | null {
    if (!from) return null;
    const match = from.match(/<([^>]+)>/);
    if (match) return match[1].toLowerCase();
    if (from.includes("@")) return from.trim().toLowerCase();
    return null;
  }

  /** Extracts plain text from email message, preferring extractedText > text > html. */
  private extractContent(msg: Record<string, unknown>): string {
    if (msg.extractedText) return (msg.extractedText as string).trim();
    if (msg.text) return (msg.text as string).trim();
    if (msg.html) return this.htmlToText(msg.html as string);
    return "";
  }

  /** Strips HTML tags to produce plain text. */
  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** Converts basic markdown to HTML for email responses. */
  private textToHtml(text: string): string {
    if (!text) return "";
    // Escape HTML entities first to prevent injection
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    return escaped
      // Code blocks: ```...``` -> <pre><code>...</code></pre>
      .replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
      // Bold: **text** -> <strong>text</strong>
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic: *text* -> <em>text</em>
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Inline code: `code` -> <code>code</code>
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Headers
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      // Links: validate URL scheme before creating anchor tags
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
        const safe = url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:");
        return safe ? `<a href="${url}">${linkText}</a>` : linkText;
      })
      // Line breaks
      .replace(/\n/g, "<br>\n");
  }
}
