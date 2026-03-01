/**
 * Slack channel implementation using Socket Mode.
 */

import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import slackifyMarkdown from "slackify-markdown";

import type { OutboundMessage } from "../bus/events.ts";
import type { MessageBus } from "../bus/queue.ts";
import { BaseChannel } from "./base.ts";
import { detectMediaType, downloadAsBytes } from "../providers/media.ts";

export interface SlackDmConfig {
  enabled: boolean;
  policy: "open" | "allowlist";
  allowFrom: string[];
}

export interface SlackConfig {
  botToken: string;
  appToken: string;
  groupPolicy: "mention" | "open" | "allowlist";
  groupAllowFrom: string[];
  dm: SlackDmConfig;
}

export class SlackChannel extends BaseChannel {
  readonly name = "slack";

  private config: SlackConfig;
  private webClient: WebClient | null = null;
  private socketClient: SocketModeClient | null = null;
  private botUserId: string | null = null;

  // Tracks threads where the bot has been engaged
  // Key: thread_ts, Value: last activity timestamp (ms)
  private _activeThreads = new Map<string, number>();
  private _threadExpiryMs = 2 * 60 * 60 * 1000; // 2 hours

  constructor(config: SlackConfig, bus: MessageBus) {
    super(bus);
    this.config = config;
  }

  async start(): Promise<void> {
    this._running = true;

    this.webClient = new WebClient(this.config.botToken);
    this.socketClient = new SocketModeClient({
      appToken: this.config.appToken,
    });

    // Resolve bot user ID for mention handling
    try {
      const auth = await this.webClient.auth.test();
      this.botUserId = (auth.user_id as string) ?? null;
      console.log(`Slack bot connected as ${this.botUserId}`);
    } catch (e) {
      console.warn(`Slack auth.test failed: ${e}`);
    }

    this.socketClient.on("error", (err: Error) => {
      console.error(`Slack socket error: ${err.message}`);
    });

    this.socketClient.on("disconnected", () => {
      console.warn("Slack socket disconnected");
    });

    this.socketClient.on("slack_event", async ({ ack, body }) => {
      try {
        const event = body?.event;
        if (!event) {
          await ack();
          return;
        }
        await this.onSocketEvent(ack, event);
      } catch (e) {
        console.error(`Slack event handler error: ${e}`);
      }
    });

    await this.socketClient.start();

    while (this._running) {
      this.pruneExpiredThreads();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async stop(): Promise<void> {
    this._running = false;
    if (this.socketClient) {
      try {
        await this.socketClient.disconnect();
      } catch (e) {
        console.warn(`Slack socket disconnect failed: ${e}`);
      }
      this.socketClient = null;
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.webClient) {
      console.warn("Slack client not running");
      return;
    }
    try {
      const slackMeta = (msg.metadata?.slack ?? {}) as Record<string, unknown>;
      const threadTs = slackMeta.thread_ts as string | undefined;
      const channelType = slackMeta.channel_type as string | undefined;
      // Only reply in thread for channel/group messages; DMs don't use threads
      const useThread = threadTs && channelType !== "im";

      // Send text message
      if (msg.content) {
        await this.webClient.chat.postMessage({
          channel: msg.chatId,
          text: this.toMrkdwn(msg.content),
          thread_ts: useThread ? threadTs : undefined,
        });
        console.log(`Slack: sent to ${msg.chatId}${useThread ? ` thread=${threadTs}` : ""} (${msg.content.length} chars)`);
      }

      // Send media attachments
      for (const item of msg.media) {
        try {
          await this.sendMediaItem(msg.chatId, item, useThread ? threadTs : undefined);
        } catch (e) {
          console.error(`Error sending Slack media: ${e}`);
        }
      }

      // Remove :eyes: reaction now that we've responded (best-effort)
      const messageTs = slackMeta.message_ts as string | undefined;
      const coalescedTs = slackMeta.coalesced_message_ts as string[] | undefined;
      const allTs = coalescedTs ?? (messageTs ? [messageTs] : []);
      for (const ts of allTs) {
        try {
          await this.webClient.reactions.remove({
            channel: msg.chatId,
            name: "eyes",
            timestamp: ts,
          });
        } catch (e) {
          console.debug(`Slack reactions.remove failed ts=${ts}: ${e}`);
        }
      }
    } catch (e) {
      console.error(`Error sending Slack message: ${e}`);
    }
  }

  private async sendMediaItem(
    channel: string,
    item: string,
    threadTs?: string,
  ): Promise<void> {
    if (!this.webClient) return;

    let fileData: Uint8Array;
    let filename: string;

    if (item.startsWith("data:")) {
      const { decodeBase64 } = await import("@std/encoding/base64");
      const base64Data = item.split(",")[1] ?? "";
      fileData = decodeBase64(base64Data);
      const mime = item.split(";")[0].slice(5);
      const extMap: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "audio/ogg": "ogg",
        "audio/opus": "opus",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
      };
      filename = `file.${extMap[mime] ?? "bin"}`;
    } else {
      // Download from URL
      const { bytes } = await downloadAsBytes(item);
      fileData = bytes;
      const urlPath = item.split("?")[0];
      filename = urlPath.split("/").pop() ?? "file";
    }

    // deno-lint-ignore no-explicit-any
    const uploadArgs: any = {
      channel_id: channel,
      file: fileData,
      filename,
    };
    if (threadTs) uploadArgs.thread_ts = threadTs;
    await this.webClient.filesUploadV2(uploadArgs);
  }

  private async onSocketEvent(
    ack: () => Promise<void>,
    event: Record<string, unknown>,
  ): Promise<void> {
    // Acknowledge immediately
    try {
      await ack();
    } catch (e) {
      console.warn(`Slack ack failed: ${e}`);
    }

    const eventType = event.type as string | undefined;

    // Handle plain messages only; drop app_mention to avoid double-processing
    // (Slack sends both message and app_mention for @-mentions in channels)
    if (eventType !== "message") {
      return;
    }

    const senderId = event.user as string | undefined;
    const chatId = event.channel as string | undefined;

    // Ignore bot/system messages (any subtype = not a normal user message)
    if (event.subtype) {
      return;
    }
    if (this.botUserId && senderId === this.botUserId) {
      return;
    }

    const text = (event.text as string) ?? "";

    console.debug(
      `Slack event: type=${eventType} subtype=${event.subtype} user=${senderId} channel=${chatId} channel_type=${event.channel_type} thread_ts=${event.thread_ts ?? "none"} text=${text.slice(0, 80)}`,
    );

    if (!senderId || !chatId) {
      return;
    }

    const channelType = (event.channel_type as string) ?? "";

    if (!this.isAllowed(senderId, chatId, channelType)) {
      return;
    }

    // Determine thread context
    const threadTs = (event.thread_ts as string) || undefined;
    const messageTs = event.ts as string;
    const effectiveThreadTs = threadTs || messageTs;
    const isMentioned = this.botUserId !== null && text.includes(`<@${this.botUserId}>`);
    let isThreadMonitored = false;

    if (channelType !== "im") {
      if (this.shouldRespondInChannel(text, chatId)) {
        // Normal path: bot was @mentioned or groupPolicy is "open"/"allowlist"
        // Track thread so we monitor replies (uses effectiveThreadTs to handle
        // both top-level mentions where thread_ts is absent and in-thread mentions)
        if (isMentioned) {
          this.trackThread(effectiveThreadTs);
        }
      } else if (threadTs && this.isThreadActive(threadTs)) {
        // Not mentioned and shouldRespondInChannel returned false,
        // but this is an active monitored thread — forward with flag
        isThreadMonitored = true;
      } else {
        // Not mentioned, not in an active thread, policy says no — ignore
        return;
      }
    }

    const strippedText = this.stripBotMention(text);

    // Add :eyes: reaction only for directly-addressed messages (not thread-monitored)
    if (!isThreadMonitored) {
      try {
        if (this.webClient && event.ts) {
          await this.webClient.reactions.add({
            channel: chatId,
            name: "eyes",
            timestamp: event.ts as string,
          });
        }
      } catch (e) {
        console.debug(`Slack reactions.add failed: ${e}`);
      }
    }

    await this.handleMessage({
      senderId,
      chatId,
      content: strippedText,
      metadata: {
        slack: {
          event,
          thread_ts: effectiveThreadTs,
          channel_type: channelType,
          message_ts: messageTs,
          threadMonitored: isThreadMonitored || undefined,
        },
      },
    });
  }

  private isAllowed(
    senderId: string,
    chatId: string,
    channelType: string,
  ): boolean {
    if (channelType === "im") {
      if (!this.config.dm.enabled) {
        return false;
      }
      if (this.config.dm.policy === "allowlist") {
        return this.config.dm.allowFrom.includes(senderId);
      }
      return true;
    }

    // Group / channel messages
    if (this.config.groupPolicy === "allowlist") {
      return this.config.groupAllowFrom.includes(chatId);
    }
    return true;
  }

  private shouldRespondInChannel(text: string, chatId: string): boolean {
    if (this.config.groupPolicy === "open") {
      return true;
    }
    if (this.config.groupPolicy === "mention") {
      return (
        this.botUserId !== null && text.includes(`<@${this.botUserId}>`)
      );
    }
    if (this.config.groupPolicy === "allowlist") {
      return this.config.groupAllowFrom.includes(chatId);
    }
    return false;
  }

  private trackThread(threadTs: string): void {
    this._activeThreads.set(threadTs, Date.now());
  }

  private isThreadActive(threadTs: string): boolean {
    const lastActivity = this._activeThreads.get(threadTs);
    if (!lastActivity) return false;
    if (Date.now() - lastActivity > this._threadExpiryMs) {
      this._activeThreads.delete(threadTs);
      return false;
    }
    // Refresh activity timestamp
    this._activeThreads.set(threadTs, Date.now());
    return true;
  }

  private pruneExpiredThreads(): void {
    const now = Date.now();
    for (const [ts, lastActivity] of this._activeThreads) {
      if (now - lastActivity > this._threadExpiryMs) {
        this._activeThreads.delete(ts);
      }
    }
  }

  private stripBotMention(text: string): string {
    if (!text || !this.botUserId) {
      return text;
    }
    const escaped = this.botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(`<@${escaped}>\\s*`, "g"), "").trim();
  }

  // Matches a full markdown table block: header row, separator row, data rows
  private static TABLE_RE =
    /^\|.*\|$(?:\n\|[\s:|\-]*\|$)(?:\n\|.*\|$)*/gm;

  private toMrkdwn(text: string): string {
    if (!text) {
      return "";
    }
    const converted = text.replace(
      SlackChannel.TABLE_RE,
      (match) => SlackChannel.convertTable(match),
    );
    return slackifyMarkdown(converted);
  }

  private static convertTable(tableText: string): string {
    const lines = tableText
      .trim()
      .split("\n")
      .map((ln) => ln.trim())
      .filter((ln) => ln.length > 0);

    if (lines.length < 2) {
      return tableText;
    }

    const headers = lines[0]
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((h) => h.trim());

    const isSeparator = /^[|\s:\-]+$/.test(lines[1]);
    const start = isSeparator ? 2 : 1;

    const rows: string[] = [];
    for (const line of lines.slice(start)) {
      const cells = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      // Pad or trim cells to match header count
      while (cells.length < headers.length) cells.push("");
      const parts = headers
        .map((h, i) => (cells[i] ? `**${h}**: ${cells[i]}` : ""))
        .filter((p) => p.length > 0);
      if (parts.length > 0) {
        rows.push(parts.join(" \u00b7 "));
      }
    }
    return rows.join("\n");
  }
}
