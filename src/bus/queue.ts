/**
 * Async message queue for decoupled channel-agent communication.
 */

import type { InboundMessage, OutboundMessage } from "./events.ts";

export interface DeadLetterEntry {
  message: OutboundMessage;
  error: string;
  timestamp: Date;
}

type OutboundCallback = (msg: OutboundMessage) => Promise<void>;

/**
 * Async message bus that decouples chat channels from the agent core.
 *
 * Channels push messages to the inbound queue, and the agent processes
 * them and pushes responses to the outbound queue.
 */
export class MessageBus {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundResolvers: ((msg: InboundMessage) => void)[] = [];
  private outboundResolvers: ((msg: OutboundMessage) => void)[] = [];
  private outboundSubscribers: Map<string, OutboundCallback[]> = new Map();
  private deadLetters: DeadLetterEntry[] = [];
  private _running = false;

  async publishInbound(msg: InboundMessage): Promise<void> {
    console.log(`Queue: inbound published [${msg.channel}:${msg.chatId}] (queue=${this.inboundQueue.length})`);
    const resolver = this.inboundResolvers.shift();
    if (resolver) {
      resolver(msg);
    } else {
      this.inboundQueue.push(msg);
    }
  }

  async consumeInbound(): Promise<InboundMessage> {
    const queued = this.inboundQueue.shift();
    if (queued) return queued;
    return new Promise<InboundMessage>((resolve) => {
      this.inboundResolvers.push(resolve);
    });
  }

  /**
   * Consume inbound with a timeout. Returns null if timeout expires.
   */
  async consumeInboundWithTimeout(
    timeoutMs: number,
  ): Promise<InboundMessage | null> {
    const queued = this.inboundQueue.shift();
    if (queued) return queued;

    return new Promise<InboundMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.inboundResolvers.indexOf(wrappedResolve);
        if (idx !== -1) this.inboundResolvers.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const wrappedResolve = (msg: InboundMessage) => {
        clearTimeout(timer);
        resolve(msg);
      };

      this.inboundResolvers.push(wrappedResolve);
    });
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    console.log(`Queue: outbound published [${msg.channel}:${msg.chatId}] (${msg.content.length} chars)`);
    const resolver = this.outboundResolvers.shift();
    if (resolver) {
      resolver(msg);
    } else {
      this.outboundQueue.push(msg);
    }
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    const queued = this.outboundQueue.shift();
    if (queued) return queued;
    return new Promise<OutboundMessage>((resolve) => {
      this.outboundResolvers.push(resolve);
    });
  }

  subscribeOutbound(channel: string, callback: OutboundCallback): void {
    const subs = this.outboundSubscribers.get(channel) ?? [];
    subs.push(callback);
    this.outboundSubscribers.set(channel, subs);
  }

  /**
   * Dispatch outbound messages to subscribed channels.
   * Run this as a background task.
   */
  async dispatchOutbound(): Promise<void> {
    this._running = true;
    while (this._running) {
      try {
        const msg = await this.consumeOutboundWithTimeout(1000);
        if (!msg) continue;

        const subscribers = this.outboundSubscribers.get(msg.channel) ?? [];
        for (const callback of subscribers) {
          try {
            await callback(msg);
          } catch (e) {
            console.error(`Error dispatching to ${msg.channel}:`, e);
            this.deadLetters.push({
              message: msg,
              error: e instanceof Error ? e.message : String(e),
              timestamp: new Date(),
            });
            console.warn(`Queue: dead letter [${msg.channel}:${msg.chatId}], total=${this.deadLetters.length}`);
            if (this.deadLetters.length > 100) {
              this.deadLetters.shift();
            }
          }
        }
      } catch {
        // continue on errors
      }
    }
  }

  private async consumeOutboundWithTimeout(
    timeoutMs: number,
  ): Promise<OutboundMessage | null> {
    const queued = this.outboundQueue.shift();
    if (queued) return queued;

    return new Promise<OutboundMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.outboundResolvers.indexOf(wrappedResolve);
        if (idx !== -1) this.outboundResolvers.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const wrappedResolve = (msg: OutboundMessage) => {
        clearTimeout(timer);
        resolve(msg);
      };

      this.outboundResolvers.push(wrappedResolve);
    });
  }

  stop(): void {
    this._running = false;
  }

  get inboundSize(): number {
    return this.inboundQueue.length;
  }

  get outboundSize(): number {
    return this.outboundQueue.length;
  }

  get deadLetterSize(): number {
    return this.deadLetters.length;
  }

  get deadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetters];
  }

  /**
   * Remove and return all queued inbound messages matching a predicate.
   * Only inspects already-queued messages; does not block.
   */
  drainMatchingInbound(
    predicate: (msg: InboundMessage) => boolean,
  ): InboundMessage[] {
    const matched: InboundMessage[] = [];
    const remaining: InboundMessage[] = [];
    for (const msg of this.inboundQueue) {
      (predicate(msg) ? matched : remaining).push(msg);
    }
    this.inboundQueue = remaining;
    return matched;
  }
}
