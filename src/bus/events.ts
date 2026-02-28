/**
 * Event types for the message bus.
 */

export interface InboundMessage {
  channel: string;
  senderId: string;
  chatId: string;
  content: string;
  timestamp: Date;
  media: string[];
  metadata: Record<string, unknown>;
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyTo?: string;
  media: string[];
  metadata: Record<string, unknown>;
}

export function createInboundMessage(
  partial: Omit<InboundMessage, "timestamp" | "media" | "metadata"> &
    Partial<Pick<InboundMessage, "timestamp" | "media" | "metadata">>,
): InboundMessage {
  return {
    timestamp: new Date(),
    media: [],
    metadata: {},
    ...partial,
  };
}

export function getSessionKey(msg: InboundMessage): string {
  const slackMeta = msg.metadata?.slack as Record<string, unknown> | undefined;
  const threadTs = slackMeta?.thread_ts as string | undefined;
  if (msg.channel === "slack" && threadTs) {
    return `${msg.channel}:${msg.chatId}:${threadTs}`;
  }
  return `${msg.channel}:${msg.chatId}`;
}
