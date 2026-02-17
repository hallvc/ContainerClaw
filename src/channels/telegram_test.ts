// deno-lint-ignore-file no-explicit-any require-await
import { assertEquals } from "@std/assert";
import { MessageBus } from "../bus/queue.ts";
import {
  TelegramChannel,
  markdownToTelegramHtml,
  splitMessage,
} from "./telegram.ts";
import type { TelegramConfig } from "../config/schema.ts";

function makeConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    bot_token: "123456:ABC-DEF",
    allow_from: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// markdownToTelegramHtml
// ---------------------------------------------------------------------------

Deno.test("markdownToTelegramHtml - empty string returns empty", () => {
  assertEquals(markdownToTelegramHtml(""), "");
});

Deno.test("markdownToTelegramHtml - plain text passes through", () => {
  assertEquals(markdownToTelegramHtml("hello world"), "hello world");
});

Deno.test("markdownToTelegramHtml - bold **text** converts to <b>", () => {
  assertEquals(markdownToTelegramHtml("**bold**"), "<b>bold</b>");
});

Deno.test("markdownToTelegramHtml - bold __text__ converts to <b>", () => {
  assertEquals(markdownToTelegramHtml("__bold__"), "<b>bold</b>");
});

Deno.test("markdownToTelegramHtml - italic _text_ converts to <i>", () => {
  assertEquals(markdownToTelegramHtml("_italic_"), "<i>italic</i>");
});

Deno.test("markdownToTelegramHtml - italic not inside words like some_var_name", () => {
  const result = markdownToTelegramHtml("some_var_name");
  assertEquals(result.includes("<i>"), false);
});

Deno.test("markdownToTelegramHtml - strikethrough ~~text~~ converts to <s>", () => {
  assertEquals(markdownToTelegramHtml("~~deleted~~"), "<s>deleted</s>");
});

Deno.test("markdownToTelegramHtml - inline code converts to <code>", () => {
  assertEquals(markdownToTelegramHtml("`code`"), "<code>code</code>");
});

Deno.test("markdownToTelegramHtml - code block converts to <pre><code>", () => {
  const input = "```\nconst x = 1;\n```";
  const result = markdownToTelegramHtml(input);
  assertEquals(result.includes("<pre><code>"), true);
  assertEquals(result.includes("const x = 1;"), true);
  assertEquals(result.includes("</code></pre>"), true);
});

Deno.test("markdownToTelegramHtml - code block with language tag", () => {
  const input = "```ts\nconst x = 1;\n```";
  const result = markdownToTelegramHtml(input);
  assertEquals(result.includes("<pre><code>"), true);
  assertEquals(result.includes("const x = 1;"), true);
});

Deno.test("markdownToTelegramHtml - escapes HTML entities", () => {
  const result = markdownToTelegramHtml("a < b & c > d");
  assertEquals(result, "a &lt; b &amp; c &gt; d");
});

Deno.test("markdownToTelegramHtml - HTML in code is escaped", () => {
  const result = markdownToTelegramHtml("`<div>`");
  assertEquals(result, "<code>&lt;div&gt;</code>");
});

Deno.test("markdownToTelegramHtml - links convert to <a>", () => {
  const result = markdownToTelegramHtml("[click](https://example.com)");
  assertEquals(result, '<a href="https://example.com">click</a>');
});

Deno.test("markdownToTelegramHtml - headers stripped to plain text", () => {
  assertEquals(markdownToTelegramHtml("# Title"), "Title");
  assertEquals(markdownToTelegramHtml("## Subtitle"), "Subtitle");
});

Deno.test("markdownToTelegramHtml - bullet lists converted", () => {
  const result = markdownToTelegramHtml("- item one\n- item two");
  assertEquals(result.includes("\u2022 item one"), true);
  assertEquals(result.includes("\u2022 item two"), true);
});

Deno.test("markdownToTelegramHtml - blockquotes stripped", () => {
  assertEquals(markdownToTelegramHtml("> quoted text"), "quoted text");
});

// ---------------------------------------------------------------------------
// splitMessage
// ---------------------------------------------------------------------------

Deno.test("splitMessage - short message returns single chunk", () => {
  const result = splitMessage("hello");
  assertEquals(result, ["hello"]);
});

Deno.test("splitMessage - splits at line breaks within max length", () => {
  const line = "a".repeat(50);
  const content = `${line}\n${line}\n${line}`;
  const result = splitMessage(content, 110);
  assertEquals(result.length, 2);
  assertEquals(result[0], `${line}\n${line}`);
});

Deno.test("splitMessage - falls back to space split", () => {
  const words = Array(100).fill("word").join(" ");
  const result = splitMessage(words, 50);
  assertEquals(result.length > 1, true);
  for (const chunk of result) {
    assertEquals(chunk.length <= 50, true);
  }
});

Deno.test("splitMessage - hard cuts when no break found", () => {
  const content = "a".repeat(200);
  const result = splitMessage(content, 50);
  assertEquals(result.length, 4);
  assertEquals(result[0], "a".repeat(50));
});

// ---------------------------------------------------------------------------
// senderId helper
// ---------------------------------------------------------------------------

Deno.test("TelegramChannel - senderId with username", () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  const result = (channel as any).buildSenderId({ id: 12345, username: "alice" });
  assertEquals(result, "12345|alice");
});

Deno.test("TelegramChannel - senderId without username", () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  const result = (channel as any).buildSenderId({ id: 12345 });
  assertEquals(result, "12345");
});

// ---------------------------------------------------------------------------
// isAllowed
// ---------------------------------------------------------------------------

Deno.test("TelegramChannel - isAllowed: empty allowlist allows all", () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig({ allow_from: [] }), bus);
  assertEquals((channel as any).isAllowed("12345|alice"), true);
});

Deno.test("TelegramChannel - isAllowed: sender in allowlist", () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(
    makeConfig({ allow_from: ["12345"] }),
    bus,
  );
  assertEquals((channel as any).isAllowed("12345|alice"), true);
});

Deno.test("TelegramChannel - isAllowed: sender not in allowlist", () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(
    makeConfig({ allow_from: ["99999"] }),
    bus,
  );
  assertEquals((channel as any).isAllowed("12345|alice"), false);
});

Deno.test("TelegramChannel - isAllowed: matches full id|username format", () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(
    makeConfig({ allow_from: ["12345|alice"] }),
    bus,
  );
  assertEquals((channel as any).isAllowed("12345|alice"), true);
});

Deno.test("TelegramChannel - isAllowed: matches id portion of sender", () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(
    makeConfig({ allow_from: ["12345"] }),
    bus,
  );
  assertEquals((channel as any).isAllowed("12345|alice"), true);
});

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

Deno.test("TelegramChannel - send: handles missing bot gracefully", async () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  // bot is null by default, should not throw
  await channel.send({
    channel: "telegram",
    chatId: "12345",
    content: "hello",
    media: [],
    metadata: {},
  });
});

Deno.test("TelegramChannel - send: sends HTML message via bot api", async () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  const sent: any[] = [];
  (channel as any)._bot = {
    api: {
      sendMessage: async (chatId: number, text: string, opts: any) => {
        sent.push({ chatId, text, opts });
      },
    },
  };
  await channel.send({
    channel: "telegram",
    chatId: "12345",
    content: "**bold**",
    media: [],
    metadata: {},
  });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].chatId, 12345);
  assertEquals(sent[0].text, "<b>bold</b>");
  assertEquals(sent[0].opts.parse_mode, "HTML");
});

Deno.test("TelegramChannel - send: falls back to plain text on HTML error", async () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  let attempts = 0;
  const sent: any[] = [];
  (channel as any)._bot = {
    api: {
      sendMessage: async (chatId: number, text: string, opts: any) => {
        attempts++;
        if (opts?.parse_mode === "HTML") {
          throw new Error("parse error");
        }
        sent.push({ chatId, text, opts });
      },
    },
  };
  await channel.send({
    channel: "telegram",
    chatId: "12345",
    content: "hello",
    media: [],
    metadata: {},
  });
  assertEquals(attempts, 2); // HTML attempt + plain text fallback
  assertEquals(sent.length, 1);
  assertEquals(sent[0].opts, undefined);
});

Deno.test("TelegramChannel - send: splits long messages into chunks", async () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  const sent: any[] = [];
  (channel as any)._bot = {
    api: {
      sendMessage: async (chatId: number, text: string, opts: any) => {
        sent.push({ chatId, text, opts });
      },
    },
  };
  const longContent = "a".repeat(5000);
  await channel.send({
    channel: "telegram",
    chatId: "12345",
    content: longContent,
    media: [],
    metadata: {},
  });
  assertEquals(sent.length, 2);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

Deno.test("TelegramChannel - stop: sets _running to false", async () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  (channel as any)._running = true;
  assertEquals(channel.isRunning, true);
  await channel.stop();
  assertEquals(channel.isRunning, false);
});

Deno.test("TelegramChannel - stop: cancels typing tasks", async () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  (channel as any)._running = true;
  // Simulate an active typing task
  let cancelled = false;
  const controller = new AbortController();
  controller.signal.addEventListener("abort", () => { cancelled = true; });
  (channel as any)._typingControllers.set("12345", controller);
  await channel.stop();
  assertEquals(cancelled, true);
  assertEquals((channel as any)._typingControllers.size, 0);
});

Deno.test("TelegramChannel - name is 'telegram'", () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);
  assertEquals(channel.name, "telegram");
});

// ---------------------------------------------------------------------------
// Voice transcription integration
// ---------------------------------------------------------------------------

Deno.test("TelegramChannel - constructor accepts optional transcriber", () => {
  const bus = new MessageBus();
  const transcriber = async (_url: string) => "transcribed text";
  const channel = new TelegramChannel(makeConfig(), bus, transcriber);
  assertEquals(channel.name, "telegram");
});

Deno.test("TelegramChannel - voice message uses transcriber when provided", async () => {
  const bus = new MessageBus();
  const transcriber = async (_url: string) => "hello from voice";
  const channel = new TelegramChannel(makeConfig(), bus, transcriber);

  const published: any[] = [];
  (channel as any).bus = {
    publishInbound: async (msg: any) => { published.push(msg); },
  };

  // Simulate onMessage with a voice message context
  const fakeCtx = {
    from: { id: 123, username: "alice" },
    chat: { id: 456, type: "private" },
    message: {
      voice: { file_id: "voice123" },
    },
    api: {
      getFile: async (_id: string) => ({ file_path: "voice/file_0.oga" }),
    },
  };

  await (channel as any).onMessage(fakeCtx);

  assertEquals(published.length, 1);
  assertEquals(published[0].content, "hello from voice");
  assertEquals(published[0].media.length, 0);
});

Deno.test("TelegramChannel - voice message falls back to URL without transcriber", async () => {
  const bus = new MessageBus();
  const channel = new TelegramChannel(makeConfig(), bus);

  const published: any[] = [];
  (channel as any).bus = {
    publishInbound: async (msg: any) => { published.push(msg); },
  };

  const fakeCtx = {
    from: { id: 123, username: "alice" },
    chat: { id: 456, type: "private" },
    message: {
      voice: { file_id: "voice123" },
    },
    api: {
      getFile: async (_id: string) => ({ file_path: "voice/file_0.oga" }),
    },
  };

  await (channel as any).onMessage(fakeCtx);

  assertEquals(published.length, 1);
  assertEquals(
    published[0].content,
    "[voice: https://api.telegram.org/file/bot123456:ABC-DEF/voice/file_0.oga]",
  );
});

Deno.test("TelegramChannel - voice message falls back to URL on transcription failure", async () => {
  const bus = new MessageBus();
  const transcriber = async (_url: string) => ""; // empty = failure
  const channel = new TelegramChannel(makeConfig(), bus, transcriber);

  const published: any[] = [];
  (channel as any).bus = {
    publishInbound: async (msg: any) => { published.push(msg); },
  };

  const fakeCtx = {
    from: { id: 123, username: "alice" },
    chat: { id: 456, type: "private" },
    message: {
      voice: { file_id: "voice123" },
    },
    api: {
      getFile: async (_id: string) => ({ file_path: "voice/file_0.oga" }),
    },
  };

  await (channel as any).onMessage(fakeCtx);

  assertEquals(published.length, 1);
  assertEquals(
    published[0].content,
    "[voice: https://api.telegram.org/file/bot123456:ABC-DEF/voice/file_0.oga]",
  );
});
