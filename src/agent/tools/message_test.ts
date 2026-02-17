import { assertEquals, assertStringIncludes } from "@std/assert";
import { MessageTool } from "./message.ts";
import type { OutboundMessage } from "../../bus/events.ts";

Deno.test("MessageTool - schema only requires content", () => {
  const tool = new MessageTool(async () => {});
  assertEquals(tool.parameters.required, ["content"]);
});

Deno.test("MessageTool - uses default channel and chatId from context", async () => {
  const msgs: OutboundMessage[] = [];
  const tool = new MessageTool(async (msg) => { msgs.push(msg); });
  tool.setContext("slack", "C123");
  const result = await tool.execute({ content: "hello" });
  assertStringIncludes(result, "slack");
  assertStringIncludes(result, "C123");
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].channel, "slack");
  assertEquals(msgs[0].chatId, "C123");
  assertEquals(msgs[0].content, "hello");
});

Deno.test("MessageTool - explicit args override defaults", async () => {
  const msgs: OutboundMessage[] = [];
  const tool = new MessageTool(async (msg) => { msgs.push(msg); });
  tool.setContext("slack", "C123");
  const result = await tool.execute({
    channel: "telegram",
    chat_id: "T456",
    content: "hi",
  });
  assertStringIncludes(result, "telegram");
  assertEquals(msgs[0].channel, "telegram");
  assertEquals(msgs[0].chatId, "T456");
});

Deno.test("MessageTool - throws when no channel available", async () => {
  const tool = new MessageTool(async () => {});
  try {
    await tool.execute({ content: "hello" });
    assertEquals(true, false, "should have thrown");
  } catch (e) {
    assertStringIncludes((e as Error).message, "channel");
  }
});
