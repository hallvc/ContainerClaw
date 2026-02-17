import { assertEquals } from "@std/assert";
import { BaseChannel } from "./base.ts";
import { MessageBus } from "../bus/queue.ts";
import type { OutboundMessage } from "../bus/events.ts";

class TestChannel extends BaseChannel {
  readonly name = "test";

  start(): Promise<void> {
    this._running = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this._running = false;
    return Promise.resolve();
  }

  send(_msg: OutboundMessage): Promise<void> {
    return Promise.resolve();
  }

  // Expose protected handleMessage for testing
  async testHandleMessage(params: {
    senderId: string;
    chatId: string;
    content: string;
    media?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.handleMessage(params);
  }
}

Deno.test("BaseChannel - concrete subclass instantiates with MessageBus", () => {
  const bus = new MessageBus();
  const channel = new TestChannel(bus);
  assertEquals(channel instanceof BaseChannel, true);
});

Deno.test("BaseChannel - name returns the subclass name", () => {
  const bus = new MessageBus();
  const channel = new TestChannel(bus);
  assertEquals(channel.name, "test");
});

Deno.test("BaseChannel - isRunning starts as false", () => {
  const bus = new MessageBus();
  const channel = new TestChannel(bus);
  assertEquals(channel.isRunning, false);
});

Deno.test("BaseChannel - handleMessage publishes InboundMessage to bus with correct fields", async () => {
  const bus = new MessageBus();
  const channel = new TestChannel(bus);

  await channel.testHandleMessage({
    senderId: "user123",
    chatId: "chat456",
    content: "hello world",
  });

  assertEquals(bus.inboundSize, 1);
  const msg = await bus.consumeInbound();
  assertEquals(msg.channel, "test");
  assertEquals(msg.senderId, "user123");
  assertEquals(msg.chatId, "chat456");
  assertEquals(msg.content, "hello world");
  assertEquals(msg.timestamp instanceof Date, true);
});

Deno.test("BaseChannel - handleMessage defaults media to [] and metadata to {}", async () => {
  const bus = new MessageBus();
  const channel = new TestChannel(bus);

  await channel.testHandleMessage({
    senderId: "user1",
    chatId: "chat1",
    content: "no extras",
  });

  const msg = await bus.consumeInbound();
  assertEquals(msg.media, []);
  assertEquals(msg.metadata, {});
});

Deno.test("BaseChannel - handleMessage passes custom media and metadata", async () => {
  const bus = new MessageBus();
  const channel = new TestChannel(bus);

  const media = ["image.png", "doc.pdf"];
  const metadata = { source: "slack", threadId: "t1" };

  await channel.testHandleMessage({
    senderId: "user2",
    chatId: "chat2",
    content: "with extras",
    media,
    metadata,
  });

  const msg = await bus.consumeInbound();
  assertEquals(msg.media, ["image.png", "doc.pdf"]);
  assertEquals(msg.metadata, { source: "slack", threadId: "t1" });
});
