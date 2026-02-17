import { assertEquals } from "@std/assert";
import { MessageBus } from "../bus/queue.ts";
import type { OutboundMessage } from "../bus/events.ts";
import { BaseChannel } from "./base.ts";
import { ChannelManager } from "./manager.ts";

class FakeChannel extends BaseChannel {
  readonly name: string;
  started = false;
  stopped = false;
  sentMessages: OutboundMessage[] = [];

  constructor(name: string, bus: MessageBus) {
    super(bus);
    this.name = name;
  }

  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }
  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }
  send(msg: OutboundMessage): Promise<void> {
    this.sentMessages.push(msg);
    return Promise.resolve();
  }
}

function makeOutbound(channel: string, content: string): OutboundMessage {
  return {
    channel,
    chatId: "chat-1",
    content,
    media: [],
    metadata: {},
  };
}

Deno.test("ChannelManager - addChannel registers channel", () => {
  const bus = new MessageBus();
  const manager = new ChannelManager(bus);
  const ch = new FakeChannel("test", bus);

  // Should not throw
  manager.addChannel(ch);
});

Deno.test("ChannelManager - startAll calls start on all channels", async () => {
  const bus = new MessageBus();
  const manager = new ChannelManager(bus);
  const ch1 = new FakeChannel("a", bus);
  const ch2 = new FakeChannel("b", bus);

  manager.addChannel(ch1);
  manager.addChannel(ch2);
  await manager.startAll();

  assertEquals(ch1.started, true);
  assertEquals(ch2.started, true);
});

Deno.test("ChannelManager - stopAll calls stop on all channels", async () => {
  const bus = new MessageBus();
  const manager = new ChannelManager(bus);
  const ch1 = new FakeChannel("a", bus);
  const ch2 = new FakeChannel("b", bus);

  manager.addChannel(ch1);
  manager.addChannel(ch2);
  await manager.stopAll();

  assertEquals(ch1.stopped, true);
  assertEquals(ch2.stopped, true);
});

Deno.test("ChannelManager - multiple channels can be registered", async () => {
  const bus = new MessageBus();
  const manager = new ChannelManager(bus);
  const channels = [
    new FakeChannel("x", bus),
    new FakeChannel("y", bus),
    new FakeChannel("z", bus),
  ];

  for (const ch of channels) {
    manager.addChannel(ch);
  }

  await manager.startAll();
  for (const ch of channels) {
    assertEquals(ch.started, true);
  }

  await manager.stopAll();
  for (const ch of channels) {
    assertEquals(ch.stopped, true);
  }
});

Deno.test("ChannelManager - outbound message routed to correct channel", async () => {
  const bus = new MessageBus();
  const manager = new ChannelManager(bus);
  const ch = new FakeChannel("test", bus);

  manager.addChannel(ch);

  const msg = makeOutbound("test", "hello");

  // Start the dispatcher in the background
  const dispatchPromise = bus.dispatchOutbound();

  // Publish and give time for dispatch
  await bus.publishOutbound(msg);
  // Allow the dispatch loop to process
  await new Promise((r) => setTimeout(r, 100));

  bus.stop();
  await dispatchPromise;

  assertEquals(ch.sentMessages.length, 1);
  assertEquals(ch.sentMessages[0].content, "hello");
  assertEquals(ch.sentMessages[0].channel, "test");
});

Deno.test("ChannelManager - messages for unregistered channels are not delivered", async () => {
  const bus = new MessageBus();
  const manager = new ChannelManager(bus);
  const ch = new FakeChannel("registered", bus);

  manager.addChannel(ch);

  const msg = makeOutbound("unregistered", "should not arrive");

  const dispatchPromise = bus.dispatchOutbound();

  await bus.publishOutbound(msg);
  await new Promise((r) => setTimeout(r, 100));

  bus.stop();
  await dispatchPromise;

  assertEquals(ch.sentMessages.length, 0);
});
