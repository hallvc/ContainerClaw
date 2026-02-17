/**
 * Abstract base channel class for chat platform integrations.
 */

import { createInboundMessage } from "../bus/events.ts";
import type { OutboundMessage } from "../bus/events.ts";
import type { MessageBus } from "../bus/queue.ts";

export abstract class BaseChannel {
  abstract readonly name: string;
  protected bus: MessageBus;
  protected _running = false;

  constructor(bus: MessageBus) {
    this.bus = bus;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  protected async handleMessage(params: {
    senderId: string;
    chatId: string;
    content: string;
    media?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const msg = createInboundMessage({
      channel: this.name,
      senderId: params.senderId,
      chatId: params.chatId,
      content: params.content,
      media: params.media ?? [],
      metadata: params.metadata ?? {},
    });
    await this.bus.publishInbound(msg);
  }

  get isRunning(): boolean {
    return this._running;
  }
}
