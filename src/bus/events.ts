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

/**
 * Key for coalescing: groups messages from the same user in the same channel.
 * Ignores per-message thread_ts so top-level messages from the same user
 * in the same channel are grouped together.
 */
export function getCoalesceKey(msg: InboundMessage): string {
  return `${msg.channel}:${msg.chatId}:${msg.senderId}`;
}

/**
 * Merge multiple InboundMessages into one coalesced message.
 * Content is formatted as a numbered list. Media arrays are concatenated.
 * All message_ts values are preserved in metadata for :eyes: cleanup.
 */
export function coalesceMessages(messages: InboundMessage[]): InboundMessage {
  if (messages.length === 1) return messages[0];

  const first = messages[0];

  const lines = messages.map((m, i) => `${i + 1}. ${m.content}`);
  const content =
    `The user sent ${messages.length} messages:\n\n${lines.join("\n")}`;

  const media = messages.flatMap((m) => m.media);

  // Collect all message_ts values for :eyes: reaction cleanup
  const allMessageTs = messages
    .map(
      (m) =>
        (m.metadata?.slack as Record<string, unknown>)?.message_ts as string,
    )
    .filter(Boolean);

  const metadata = structuredClone(first.metadata);
  if (metadata.slack) {
    (metadata.slack as Record<string, unknown>).coalesced_message_ts =
      allMessageTs;
  }

  return { ...first, content, media, metadata };
}
