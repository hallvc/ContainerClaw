/**
 * Telegram channel implementation using grammY (long polling).
 */

import { Bot, InputFile } from "grammy";
import type { Context } from "grammy";

import type { OutboundMessage } from "../bus/events.ts";
import type { MessageBus } from "../bus/queue.ts";
import type { TelegramConfig } from "../config/schema.ts";
import { BaseChannel } from "./base.ts";
import { detectMediaType, downloadAsBase64 } from "../providers/media.ts";

export function markdownToTelegramHtml(text: string): string {
  if (!text) return "";

  // 1. Extract and protect code blocks
  const codeBlocks: string[] = [];
  const saveCodeBlock = (_: string, code: string): string => {
    codeBlocks.push(code);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  };
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, saveCodeBlock);

  // 2. Extract and protect inline code
  const inlineCodes: string[] = [];
  const saveInlineCode = (_: string, code: string): string => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  };
  text = text.replace(/`([^`]+)`/g, saveInlineCode);

  // 3. Headers -> plain text
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1");

  // 4. Blockquotes -> plain text
  text = text.replace(/^>\s*(.*)$/gm, "$1");

  // 5. Escape HTML entities
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 6. Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    const safe = url.startsWith("https://") || url.startsWith("http://");
    return safe ? `<a href="${url}">${linkText}</a>` : linkText;
  });

  // 7. Bold **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");

  // 8. Italic _text_ (not inside words)
  text = text.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, "<i>$1</i>");

  // 9. Strikethrough ~~text~~
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 10. Bullet lists
  text = text.replace(/^[-*]\s+/gm, "\u2022 ");

  // 11. Restore inline code
  for (let i = 0; i < inlineCodes.length; i++) {
    const escaped = inlineCodes[i]
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    text = text.replace(`\x00IC${i}\x00`, `<code>${escaped}</code>`);
  }

  // 12. Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    const escaped = codeBlocks[i]
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    text = text.replace(`\x00CB${i}\x00`, `<pre><code>${escaped}</code></pre>`);
  }

  return text;
}

export function splitMessage(content: string, maxLen = 4000): string[] {
  if (content.length <= maxLen) return [content];

  const chunks: string[] = [];
  while (content.length > 0) {
    if (content.length <= maxLen) {
      chunks.push(content);
      break;
    }
    const cut = content.slice(0, maxLen);
    let pos = cut.lastIndexOf("\n");
    if (pos === -1) pos = cut.lastIndexOf(" ");
    if (pos === -1) pos = maxLen;
    chunks.push(content.slice(0, pos));
    content = content.slice(pos).trimStart();
  }
  return chunks;
}

export class TelegramChannel extends BaseChannel {
  readonly name = "telegram";

  private config: TelegramConfig;
  private _bot: Bot | null = null;
  private _typingControllers = new Map<string, AbortController>();
  private transcriber?: (audioUrl: string) => Promise<string>;

  constructor(
    config: TelegramConfig,
    bus: MessageBus,
    transcriber?: (audioUrl: string) => Promise<string>,
  ) {
    super(bus);
    this.config = config;
    this.transcriber = transcriber;
  }

  async start(): Promise<void> {
    if (!this.config.bot_token) {
      console.error("Telegram bot token not configured");
      return;
    }

    this._running = true;
    this._bot = new Bot(this.config.bot_token);

    this._bot.catch((err) => {
      console.error(`Telegram error: ${err.message}`);
    });

    // Command handlers
    this._bot.command("start", (ctx) => this.onStart(ctx));
    this._bot.command("new", (ctx) => this.onForwardCommand(ctx));
    this._bot.command("help", (ctx) => this.onForwardCommand(ctx));

    // Message handler for text, photos, voice, audio, documents
    this._bot.on(
      ["message:text", "message:photo", "message:voice", "message:audio", "message:document"],
      (ctx) => this.onMessage(ctx),
    );

    console.log("Starting Telegram bot (polling mode)...");

    // Register bot commands menu
    try {
      await this._bot.api.setMyCommands([
        { command: "start", description: "Start the bot" },
        { command: "new", description: "Start a new conversation" },
        { command: "help", description: "Show available commands" },
      ]);
    } catch (e) {
      console.warn(`Failed to register bot commands: ${e}`);
    }

    // Start long polling
    this._bot.start({ drop_pending_updates: true });

    // Keep running until stopped
    while (this._running) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async stop(): Promise<void> {
    this._running = false;

    // Cancel all typing indicators
    for (const [chatId, controller] of this._typingControllers) {
      controller.abort();
      this._typingControllers.delete(chatId);
    }

    if (this._bot) {
      console.log("Stopping Telegram bot...");
      await this._bot.stop();
      this._bot = null;
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this._bot) {
      console.warn("Telegram bot not running");
      return;
    }

    this.stopTyping(msg.chatId);

    let chatId: number;
    try {
      chatId = parseInt(msg.chatId, 10);
      if (isNaN(chatId)) throw new Error("NaN");
    } catch {
      console.error(`Invalid chat_id: ${msg.chatId}`);
      return;
    }

    // Send text content (if any)
    if (msg.content) {
      for (const chunk of splitMessage(msg.content)) {
        try {
          const html = markdownToTelegramHtml(chunk);
          await this._bot.api.sendMessage(chatId, html, { parse_mode: "HTML" });
        } catch {
          try {
            await this._bot.api.sendMessage(chatId, chunk);
          } catch (e2) {
            console.error(`Error sending Telegram message: ${e2}`);
          }
        }
      }
    }

    // Send media attachments
    for (const item of msg.media) {
      try {
        await this.sendMediaItem(chatId, item);
      } catch (e) {
        console.error(`Error sending Telegram media: ${e}`);
      }
    }
  }

  private async sendMediaItem(chatId: number, item: string): Promise<void> {
    if (!this._bot) return;

    const mediaType = detectMediaType(item);

    if (item.startsWith("data:")) {
      // Data URI: decode to bytes and send as InputFile
      const base64Data = item.split(",")[1] ?? "";
      const { decodeBase64 } = await import("@std/encoding/base64");
      const bytes = decodeBase64(base64Data);
      const file = new InputFile(bytes);

      if (mediaType === "image") {
        await this._bot.api.sendPhoto(chatId, file);
      } else if (mediaType === "audio") {
        // Check if it's ogg/opus for voice bubble rendering
        const mime = item.split(";")[0].slice(5);
        if (mime === "audio/ogg" || mime === "audio/opus") {
          await this._bot.api.sendVoice(chatId, file);
        } else {
          await this._bot.api.sendAudio(chatId, file);
        }
      } else {
        await this._bot.api.sendDocument(chatId, file);
      }
    } else {
      // URL (S3 or HTTP): pass directly to Telegram
      if (mediaType === "image") {
        await this._bot.api.sendPhoto(chatId, item);
      } else if (mediaType === "audio") {
        // Check extension for voice bubble
        const ext = item.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
        if (ext === "ogg" || ext === "oga" || ext === "opus") {
          await this._bot.api.sendVoice(chatId, item);
        } else {
          await this._bot.api.sendAudio(chatId, item);
        }
      } else {
        await this._bot.api.sendDocument(chatId, item);
      }
    }
  }

  private async onStart(ctx: Context): Promise<void> {
    const user = ctx.from;
    if (!user) return;
    await ctx.reply(
      `Hi ${user.first_name}! I'm ContainerClaw.\n\n` +
        "Send me a message and I'll respond!\n" +
        "Type /help to see available commands.",
    );
  }

  private async onForwardCommand(ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.chat) return;
    const senderId = this.buildSenderId(ctx.from);
    await this.handleMessage({
      senderId,
      chatId: String(ctx.chat.id),
      content: ctx.message?.text ?? "",
    });
  }

  private async onMessage(ctx: Context): Promise<void> {
    if (!ctx.from || !ctx.chat) return;

    const senderId = this.buildSenderId(ctx.from);

    if (!this.isAllowed(senderId)) return;

    const contentParts: string[] = [];
    const mediaPaths: string[] = [];

    // Text content
    if (ctx.message?.text) contentParts.push(ctx.message.text);
    if (ctx.message?.caption) contentParts.push(ctx.message.caption);

    // Handle media
    if (ctx.message?.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      try {
        const file = await ctx.api.getFile(photo.file_id);
        if (file.file_path) {
          const url = `https://api.telegram.org/file/bot${this.config.bot_token}/${file.file_path}`;
          try {
            const { data, mimeType } = await downloadAsBase64(url);
            const dataUri = `data:${mimeType};base64,${data}`;
            mediaPaths.push(dataUri);
          } catch {
            contentParts.push(`[image: download failed]`);
          }
        }
      } catch (e) {
        console.error(`Failed to get photo: ${e}`);
        contentParts.push("[image: download failed]");
      }
    } else if (ctx.message?.voice) {
      try {
        const file = await ctx.api.getFile(ctx.message.voice.file_id);
        if (file.file_path) {
          const url = `https://api.telegram.org/file/bot${this.config.bot_token}/${file.file_path}`;
          // Download eagerly as data URI
          let audioDataUri = "";
          try {
            const { data, mimeType } = await downloadAsBase64(url);
            audioDataUri = `data:${mimeType};base64,${data}`;
          } catch {
            // Download failed, continue with transcription only
          }
          // Transcribe
          let text = "";
          if (this.transcriber) {
            text = await this.transcriber(url);
          }
          if (text) {
            contentParts.push(text);
          }
          // Always push audio data URI if we have it (both transcription AND raw audio)
          if (audioDataUri) {
            mediaPaths.push(audioDataUri);
          } else if (!text) {
            contentParts.push(`[voice: download failed]`);
          }
        }
      } catch (e) {
        console.error(`Failed to get voice: ${e}`);
        contentParts.push("[voice: download failed]");
      }
    } else if (ctx.message?.audio) {
      try {
        const file = await ctx.api.getFile(ctx.message.audio.file_id);
        if (file.file_path) {
          const url = `https://api.telegram.org/file/bot${this.config.bot_token}/${file.file_path}`;
          // Download eagerly as data URI
          let audioDataUri = "";
          try {
            const { data, mimeType } = await downloadAsBase64(url);
            audioDataUri = `data:${mimeType};base64,${data}`;
          } catch {
            // Download failed, continue with transcription only
          }
          // Transcribe
          let text = "";
          if (this.transcriber) {
            text = await this.transcriber(url);
          }
          if (text) {
            contentParts.push(text);
          }
          // Always push audio data URI if we have it (both transcription AND raw audio)
          if (audioDataUri) {
            mediaPaths.push(audioDataUri);
          } else if (!text) {
            contentParts.push(`[audio: download failed]`);
          }
        }
      } catch (e) {
        console.error(`Failed to get audio: ${e}`);
        contentParts.push("[audio: download failed]");
      }
    } else if (ctx.message?.document) {
      try {
        const file = await ctx.api.getFile(ctx.message.document.file_id);
        if (file.file_path) {
          const url = `https://api.telegram.org/file/bot${this.config.bot_token}/${file.file_path}`;
          try {
            const { data, mimeType } = await downloadAsBase64(url);
            const dataUri = `data:${mimeType};base64,${data}`;
            mediaPaths.push(dataUri);
          } catch {
            contentParts.push(`[file: download failed]`);
          }
        }
      } catch (e) {
        console.error(`Failed to get document: ${e}`);
        contentParts.push("[file: download failed]");
      }
    }

    const content = contentParts.length > 0 ? contentParts.join("\n") : "[empty message]";
    const chatId = String(ctx.chat.id);

    // Start typing indicator
    this.startTyping(chatId);

    await this.handleMessage({
      senderId,
      chatId,
      content,
      media: mediaPaths,
      metadata: {
        message_id: ctx.message?.message_id,
        user_id: ctx.from.id,
        username: ctx.from.username,
        first_name: ctx.from.first_name,
        is_group: ctx.chat.type !== "private",
      },
    });
  }

  private buildSenderId(user: { id: number; username?: string }): string {
    const sid = String(user.id);
    return user.username ? `${sid}|${user.username}` : sid;
  }

  private isAllowed(senderId: string): boolean {
    if (this.config.allow_from.length === 0) return true;
    const idPart = senderId.split("|")[0];
    return this.config.allow_from.some(
      (allowed) => allowed === senderId || allowed === idPart,
    );
  }

  private startTyping(chatId: string): void {
    this.stopTyping(chatId);
    const controller = new AbortController();
    this._typingControllers.set(chatId, controller);
    this.typingLoop(chatId, controller.signal);
  }

  private stopTyping(chatId: string): void {
    const controller = this._typingControllers.get(chatId);
    if (controller) {
      controller.abort();
      this._typingControllers.delete(chatId);
    }
  }

  private async typingLoop(chatId: string, signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted && this._bot) {
        await this._bot.api.sendChatAction(parseInt(chatId, 10), "typing");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 4000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
    } catch {
      // Expected when abort signal fires
    }
  }
}
