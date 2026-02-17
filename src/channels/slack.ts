/**
 * Slack channel implementation using Socket Mode.
 */

import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import slackifyMarkdown from "slackify-markdown";

import type { OutboundMessage } from "../bus/events.ts";
import type { MessageBus } from "../bus/queue.ts";
import { BaseChannel } from "./base.ts";

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

    this.socketClient.on("slack_event", async ({ ack, event }) => {
      await this.onSocketEvent(ack, event);
    });

    await this.socketClient.start();

    while (this._running) {
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
      await this.webClient.chat.postMessage({
        channel: msg.chatId,
        text: this.toMrkdwn(msg.content),
        thread_ts: useThread ? threadTs : undefined,
      });
    } catch (e) {
      console.error(`Error sending Slack message: ${e}`);
    }
  }

  private async onSocketEvent(
    ack: () => Promise<void>,
    event: Record<string, unknown>,
  ): Promise<void> {
    // Acknowledge immediately
    await ack();

    const eventType = event.type as string | undefined;

    // Handle app mentions or plain messages only
    if (eventType !== "message" && eventType !== "app_mention") {
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

    // Avoid double-processing: Slack sends both `message` and `app_mention`
    // for mentions in channels. Prefer `app_mention`.
    const text = (event.text as string) ?? "";
    if (
      eventType === "message" &&
      this.botUserId &&
      text.includes(`<@${this.botUserId}>`)
    ) {
      return;
    }

    console.debug(
      `Slack event: type=${eventType} subtype=${event.subtype} user=${senderId} channel=${chatId} channel_type=${event.channel_type} text=${text.slice(0, 80)}`,
    );

    if (!senderId || !chatId) {
      return;
    }

    const channelType = (event.channel_type as string) ?? "";

    if (!this.isAllowed(senderId, chatId, channelType)) {
      return;
    }

    if (
      channelType !== "im" &&
      !this.shouldRespondInChannel(eventType, text, chatId)
    ) {
      return;
    }

    const strippedText = this.stripBotMention(text);
    const threadTs = (event.thread_ts as string) || (event.ts as string);

    // Add :eyes: reaction to the triggering message (best-effort)
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

    await this.handleMessage({
      senderId,
      chatId,
      content: strippedText,
      metadata: {
        slack: {
          event,
          thread_ts: threadTs,
          channel_type: channelType,
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

  private shouldRespondInChannel(
    eventType: string,
    text: string,
    chatId: string,
  ): boolean {
    if (this.config.groupPolicy === "open") {
      return true;
    }
    if (this.config.groupPolicy === "mention") {
      if (eventType === "app_mention") {
        return true;
      }
      return (
        this.botUserId !== null && text.includes(`<@${this.botUserId}>`)
      );
    }
    if (this.config.groupPolicy === "allowlist") {
      return this.config.groupAllowFrom.includes(chatId);
    }
    return false;
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
