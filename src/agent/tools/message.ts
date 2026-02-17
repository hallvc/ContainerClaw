/**
 * Message tool for sending outbound messages via a callback.
 */

import type { OutboundMessage } from "../../bus/events.ts";
import type { Tool } from "./base.ts";

type SendCallback = (msg: OutboundMessage) => Promise<void>;

export class MessageTool implements Tool {
  name = "message";
  description =
    "Send a message to a chat channel. Use this to reply to the user.";
  parameters = {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Channel name (e.g. 'slack', 'telegram').",
      },
      chat_id: {
        type: "string",
        description: "Chat or conversation ID.",
      },
      content: {
        type: "string",
        description: "Message content to send.",
      },
    },
    required: ["channel", "chat_id", "content"],
  };

  private defaultChannel?: string;
  private defaultChatId?: string;

  constructor(private sendCallback: SendCallback) {}

  setContext(channel: string, chatId: string): void {
    this.defaultChannel = channel;
    this.defaultChatId = chatId;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const channel = String(args.channel ?? this.defaultChannel ?? "");
    const chatId = String(args.chat_id ?? this.defaultChatId ?? "");
    const content = String(args.content ?? "");

    if (!channel) throw new Error("channel is required.");
    if (!chatId) throw new Error("chat_id is required.");

    const msg: OutboundMessage = {
      channel,
      chatId,
      content,
      media: [],
      metadata: {},
    };

    await this.sendCallback(msg);
    return `Message sent to ${channel}/${chatId}.`;
  }
}
