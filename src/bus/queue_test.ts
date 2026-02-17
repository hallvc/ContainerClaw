import { assertEquals } from "@std/assert";
import { MessageBus } from "./queue.ts";
import type { InboundMessage, OutboundMessage } from "./events.ts";
import { createInboundMessage } from "./events.ts";

function makeInbound(content: string): InboundMessage {
  return createInboundMessage({
    channel: "test",
    senderId: "user1",
    chatId: "chat1",
    content,
  });
}

Deno.test("MessageBus - publish and consume inbound", async () => {
  const bus = new MessageBus();
  const msg = makeInbound("hello");
  await bus.publishInbound(msg);
  const received = await bus.consumeInbound();
  assertEquals(received.content, "hello");
});

Deno.test("MessageBus - consumeInbound blocks until publish", async () => {
  const bus = new MessageBus();
  const promise = bus.consumeInbound();
  const msg = makeInbound("delayed");
  await bus.publishInbound(msg);
  const received = await promise;
  assertEquals(received.content, "delayed");
});

Deno.test("MessageBus - consumeInboundWithTimeout returns null on timeout", async () => {
  const bus = new MessageBus();
  const result = await bus.consumeInboundWithTimeout(50);
  assertEquals(result, null);
});

Deno.test("MessageBus - consumeInboundWithTimeout returns message before timeout", async () => {
  const bus = new MessageBus();
  const msg = makeInbound("fast");
  await bus.publishInbound(msg);
  const result = await bus.consumeInboundWithTimeout(1000);
  assertEquals(result?.content, "fast");
});

Deno.test("MessageBus - publish and consume outbound", async () => {
  const bus = new MessageBus();
  const msg: OutboundMessage = {
    channel: "test",
    chatId: "chat1",
    content: "response",
    media: [],
    metadata: {},
  };
  await bus.publishOutbound(msg);
  const received = await bus.consumeOutbound();
  assertEquals(received.content, "response");
});

Deno.test("MessageBus - inboundSize and outboundSize", async () => {
  const bus = new MessageBus();
  assertEquals(bus.inboundSize, 0);
  assertEquals(bus.outboundSize, 0);
  await bus.publishInbound(makeInbound("a"));
  await bus.publishInbound(makeInbound("b"));
  assertEquals(bus.inboundSize, 2);
  await bus.consumeInbound();
  assertEquals(bus.inboundSize, 1);
});
