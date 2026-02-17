import { assertEquals } from "@std/assert";
import { createInboundMessage, getSessionKey } from "./events.ts";

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
