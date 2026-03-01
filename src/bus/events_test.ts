import { assertEquals } from "@std/assert";
import {
  createInboundMessage,
  getSessionKey,
  getCoalesceKey,
  coalesceMessages,
} from "./events.ts";

Deno.test("createInboundMessage - sets defaults", () => {
  const msg = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "hello",
  });
  assertEquals(msg.channel, "slack");
  assertEquals(msg.media.length, 0);
  assertEquals(typeof msg.timestamp, "object");
});

Deno.test("getSessionKey - format", () => {
  const msg = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "test",
  });
  assertEquals(getSessionKey(msg), "slack:C456");
});

Deno.test("getSessionKey - includes thread_ts for Slack", () => {
  const msg = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "test",
    metadata: { slack: { thread_ts: "1234.5678" } },
  });
  assertEquals(getSessionKey(msg), "slack:C456:1234.5678");
});

Deno.test("getSessionKey - no thread_ts for non-Slack channels", () => {
  const msg = createInboundMessage({
    channel: "telegram",
    senderId: "U123",
    chatId: "C456",
    content: "test",
    metadata: { slack: { thread_ts: "1234.5678" } },
  });
  assertEquals(getSessionKey(msg), "telegram:C456");
});

// ---------------------------------------------------------------------------
// getCoalesceKey
// ---------------------------------------------------------------------------

Deno.test("getCoalesceKey - groups by channel, chatId, senderId", () => {
  const msg = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "test",
  });
  assertEquals(getCoalesceKey(msg), "slack:C456:U123");
});

Deno.test("getCoalesceKey - same key for same user in same channel", () => {
  const msg1 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "first",
    metadata: { slack: { thread_ts: "111.111", message_ts: "111.111" } },
  });
  const msg2 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "second",
    metadata: { slack: { thread_ts: "222.222", message_ts: "222.222" } },
  });
  assertEquals(getCoalesceKey(msg1), getCoalesceKey(msg2));
});

Deno.test("getCoalesceKey - different key for different users", () => {
  const msg1 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "hello",
  });
  const msg2 = createInboundMessage({
    channel: "slack",
    senderId: "U789",
    chatId: "C456",
    content: "hello",
  });
  assertEquals(getCoalesceKey(msg1) !== getCoalesceKey(msg2), true);
});

// ---------------------------------------------------------------------------
// coalesceMessages
// ---------------------------------------------------------------------------

Deno.test("coalesceMessages - single message passthrough", () => {
  const msg = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "hello",
  });
  const result = coalesceMessages([msg]);
  assertEquals(result, msg);
});

Deno.test("coalesceMessages - merges content as numbered list", () => {
  const msg1 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "plan a content strategy",
    metadata: { slack: { message_ts: "111.111" } },
  });
  const msg2 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "any options for disposable emails",
    metadata: { slack: { message_ts: "222.222" } },
  });
  const result = coalesceMessages([msg1, msg2]);
  assertEquals(result.content.includes("1. plan a content strategy"), true);
  assertEquals(result.content.includes("2. any options for disposable emails"), true);
  assertEquals(result.content.includes("sent 2 messages"), true);
});

Deno.test("coalesceMessages - merges media arrays", () => {
  const msg1 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "a",
    media: ["img1.png"],
    metadata: { slack: { message_ts: "111" } },
  });
  const msg2 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "b",
    media: ["img2.png", "img3.png"],
    metadata: { slack: { message_ts: "222" } },
  });
  const result = coalesceMessages([msg1, msg2]);
  assertEquals(result.media, ["img1.png", "img2.png", "img3.png"]);
});

Deno.test("coalesceMessages - collects all message_ts for eyes cleanup", () => {
  const msg1 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "a",
    metadata: { slack: { message_ts: "111.111", thread_ts: "111.111" } },
  });
  const msg2 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "b",
    metadata: { slack: { message_ts: "222.222", thread_ts: "222.222" } },
  });
  const result = coalesceMessages([msg1, msg2]);
  const slack = result.metadata.slack as Record<string, unknown>;
  assertEquals(slack.coalesced_message_ts, ["111.111", "222.222"]);
});

Deno.test("coalesceMessages - preserves first message identity", () => {
  const msg1 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "first",
    metadata: { slack: { message_ts: "111", thread_ts: "111" } },
  });
  const msg2 = createInboundMessage({
    channel: "slack",
    senderId: "U123",
    chatId: "C456",
    content: "second",
    metadata: { slack: { message_ts: "222", thread_ts: "222" } },
  });
  const result = coalesceMessages([msg1, msg2]);
  assertEquals(result.channel, "slack");
  assertEquals(result.senderId, "U123");
  assertEquals(result.chatId, "C456");
});
