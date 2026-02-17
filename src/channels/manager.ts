/**
 * Channel manager for coordinating chat channels.
 */

import type { MessageBus } from "../bus/queue.ts";
import type { BaseChannel } from "./base.ts";

export class ChannelManager {
  private bus: MessageBus;
  private channels: BaseChannel[] = [];

  constructor(bus: MessageBus) {
    this.bus = bus;
  }

  addChannel(channel: BaseChannel): void {
    this.channels.push(channel);
    this.bus.subscribeOutbound(channel.name, (msg) => channel.send(msg));
  }

  async startAll(): Promise<void> {
    await Promise.all(this.channels.map((ch) => ch.start()));
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.channels.map((ch) => ch.stop()));
  }
}
