import { assertEquals, assertGreater } from "@std/assert";
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

// ---------------------------------------------------------------------------
// Dead-letter queue
// ---------------------------------------------------------------------------

function makeOutbound(content: string, channel = "test"): OutboundMessage {
  return {
    channel,
    chatId: "chat1",
    content,
    media: [],
    metadata: {},
  };
}

Deno.test("MessageBus - failed dispatch adds entry to dead-letter queue", async () => {
  const bus = new MessageBus();
  bus.subscribeOutbound("test", async () => {
    throw new Error("send failed");
  });
  await bus.publishOutbound(makeOutbound("doomed"));

  // Run dispatcher briefly then stop
  const dispatcher = bus.dispatchOutbound();
  await new Promise((r) => setTimeout(r, 100));
  bus.stop();
  await dispatcher;

  assertEquals(bus.deadLetterSize, 1);
  const entries = bus.deadLetterQueue;
  assertEquals(entries[0].message.content, "doomed");
  assertEquals(entries[0].error, "send failed");
  assertGreater(entries[0].timestamp.getTime(), 0);
});

Deno.test("MessageBus - successful dispatch leaves dead-letter queue empty", async () => {
  const bus = new MessageBus();
  bus.subscribeOutbound("test", async () => {
    // success — no throw
  });
  await bus.publishOutbound(makeOutbound("ok"));

  const dispatcher = bus.dispatchOutbound();
  await new Promise((r) => setTimeout(r, 100));
  bus.stop();
  await dispatcher;

  assertEquals(bus.deadLetterSize, 0);
});

Deno.test("MessageBus - dead-letter queue capped at 100 entries", async () => {
  const bus = new MessageBus();
  bus.subscribeOutbound("test", async () => {
    throw new Error("fail");
  });

  // Publish 110 messages
  for (let i = 0; i < 110; i++) {
    await bus.publishOutbound(makeOutbound(`msg-${i}`));
  }

  const dispatcher = bus.dispatchOutbound();
  await new Promise((r) => setTimeout(r, 500));
  bus.stop();
  await dispatcher;

  assertEquals(bus.deadLetterSize, 100);
  // Oldest entries (0-9) should have been evicted; first entry should be msg-10
  assertEquals(bus.deadLetterQueue[0].message.content, "msg-10");
});

Deno.test("MessageBus - deadLetterQueue getter returns a copy", async () => {
  const bus = new MessageBus();
  bus.subscribeOutbound("test", async () => {
    throw new Error("fail");
  });
  await bus.publishOutbound(makeOutbound("entry"));

  const dispatcher = bus.dispatchOutbound();
  await new Promise((r) => setTimeout(r, 100));
  bus.stop();
  await dispatcher;

  const copy = bus.deadLetterQueue;
  copy.length = 0; // mutate the copy
  assertEquals(bus.deadLetterSize, 1); // original unchanged
});
