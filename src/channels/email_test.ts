// deno-lint-ignore-file no-explicit-any require-await
import { assertEquals } from "@std/assert";
import { MessageBus } from "../bus/queue.ts";
import { EmailChannel } from "./email.ts";
import type { EmailChannelConfig } from "./email.ts";

function makeConfig(
  overrides: Partial<EmailChannelConfig> = {},
): EmailChannelConfig {
  return {
    apiKey: "test-api-key",
    inboxId: "test-inbox-id",
    username: "",
    domain: "",
    pollIntervalSeconds: 15,
    policy: "open",
    allowFrom: [],
    dataDir: "/tmp",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isAllowed
// ---------------------------------------------------------------------------

Deno.test("EmailChannel - isAllowed: open policy allows any sender", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).isAllowed("anyone@example.com");
  assertEquals(result, true);
});

Deno.test("EmailChannel - isAllowed: allowlist policy allows sender in list", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(
    makeConfig({
      policy: "allowlist",
      allowFrom: ["allowed@example.com"],
    }),
    bus,
  );
  const result = (channel as any).isAllowed("allowed@example.com");
  assertEquals(result, true);
});

Deno.test("EmailChannel - isAllowed: allowlist policy denies sender not in list", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(
    makeConfig({
      policy: "allowlist",
      allowFrom: ["allowed@example.com"],
    }),
    bus,
  );
  const result = (channel as any).isAllowed("other@example.com");
  assertEquals(result, false);
});

Deno.test("EmailChannel - isAllowed: allowlist comparison is case-insensitive", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(
    makeConfig({
      policy: "allowlist",
      allowFrom: ["Allowed@Example.COM"],
    }),
    bus,
  );
  const result = (channel as any).isAllowed("allowed@example.com");
  assertEquals(result, true);
});

// ---------------------------------------------------------------------------
// extractSenderAddress
// ---------------------------------------------------------------------------

Deno.test("EmailChannel - extractSenderAddress: extracts from 'Display Name <email>' format", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractSenderAddress(
    "John Doe <john@example.com>",
  );
  assertEquals(result, "john@example.com");
});

Deno.test("EmailChannel - extractSenderAddress: handles plain email address", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractSenderAddress("john@example.com");
  assertEquals(result, "john@example.com");
});

Deno.test("EmailChannel - extractSenderAddress: returns null for undefined", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractSenderAddress(undefined);
  assertEquals(result, null);
});

Deno.test("EmailChannel - extractSenderAddress: returns null for string without @", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractSenderAddress("not-an-email");
  assertEquals(result, null);
});

Deno.test("EmailChannel - extractSenderAddress: lowercases the address", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractSenderAddress("John@Example.COM");
  assertEquals(result, "john@example.com");
});

// ---------------------------------------------------------------------------
// extractContent
// ---------------------------------------------------------------------------

Deno.test("EmailChannel - extractContent: prefers extractedText", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractContent({
    extractedText: "extracted",
    text: "plain",
    html: "<p>html</p>",
  });
  assertEquals(result, "extracted");
});

Deno.test("EmailChannel - extractContent: falls back to text", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractContent({
    text: "plain text",
    html: "<p>html</p>",
  });
  assertEquals(result, "plain text");
});

Deno.test("EmailChannel - extractContent: falls back to html with tag stripping", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractContent({
    html: "<p>hello <strong>world</strong></p>",
  });
  assertEquals(result, "hello world");
});

Deno.test("EmailChannel - extractContent: returns empty for no content", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).extractContent({});
  assertEquals(result, "");
});

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------

Deno.test("EmailChannel - htmlToText: strips tags", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).htmlToText(
    "<p>Hello <strong>world</strong></p>",
  );
  assertEquals(result, "Hello world");
});

Deno.test("EmailChannel - htmlToText: converts <br> to newlines", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).htmlToText("line1<br>line2<br/>line3");
  assertEquals(result, "line1\nline2\nline3");
});

Deno.test("EmailChannel - htmlToText: decodes HTML entities", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).htmlToText(
    "&amp; &lt; &gt; &quot; &#39; &nbsp;",
  );
  assertEquals(result, "& < > \" '");
});

Deno.test("EmailChannel - htmlToText: handles empty string", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).htmlToText("");
  assertEquals(result, "");
});

// ---------------------------------------------------------------------------
// textToHtml
// ---------------------------------------------------------------------------

Deno.test("EmailChannel - textToHtml: converts bold markdown", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).textToHtml("**bold**");
  assertEquals(result.includes("<strong>bold</strong>"), true);
});

Deno.test("EmailChannel - textToHtml: converts italic markdown", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).textToHtml("*italic*");
  assertEquals(result.includes("<em>italic</em>"), true);
});

Deno.test("EmailChannel - textToHtml: converts inline code", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).textToHtml("`code`");
  assertEquals(result.includes("<code>code</code>"), true);
});

Deno.test("EmailChannel - textToHtml: converts links", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).textToHtml("[click](https://example.com)");
  assertEquals(
    result.includes('<a href="https://example.com">click</a>'),
    true,
  );
});

Deno.test("EmailChannel - textToHtml: converts newlines to <br>", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).textToHtml("line1\nline2");
  assertEquals(result.includes("<br>"), true);
});

Deno.test("EmailChannel - textToHtml: handles empty string", () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  const result = (channel as any).textToHtml("");
  assertEquals(result, "");
});

// ---------------------------------------------------------------------------
// processInboundMessage
// ---------------------------------------------------------------------------

Deno.test("EmailChannel - processInboundMessage: publishes valid message to bus", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  (channel as any).inboxAddress = "bot@agentmail.to";

  await (channel as any).processInboundMessage({
    from: "user@example.com",
    threadId: "thread-123",
    messageId: "msg-456",
    subject: "Hello",
    text: "Hi there",
    to: ["bot@agentmail.to"],
  });

  assertEquals(bus.inboundSize, 1);
  const msg = await bus.consumeInbound();
  assertEquals(msg.channel, "email");
  assertEquals(msg.senderId, "user@example.com");
  assertEquals(msg.chatId, "thread-123");
  assertEquals(msg.content, "[Subject: Hello]\n\nHi there");
});

Deno.test("EmailChannel - processInboundMessage: skips own messages (echo prevention)", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  (channel as any).inboxAddress = "bot@agentmail.to";

  await (channel as any).processInboundMessage({
    from: "bot@agentmail.to",
    threadId: "thread-123",
    messageId: "msg-456",
    text: "echo",
  });

  assertEquals(bus.inboundSize, 0);
});

Deno.test("EmailChannel - processInboundMessage: skips when isAllowed returns false", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(
    makeConfig({ policy: "allowlist", allowFrom: ["allowed@example.com"] }),
    bus,
  );
  (channel as any).inboxAddress = "bot@agentmail.to";

  await (channel as any).processInboundMessage({
    from: "denied@example.com",
    threadId: "thread-123",
    messageId: "msg-456",
    text: "hello",
  });

  assertEquals(bus.inboundSize, 0);
});

Deno.test("EmailChannel - processInboundMessage: skips empty content", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  (channel as any).inboxAddress = "bot@agentmail.to";

  await (channel as any).processInboundMessage({
    from: "user@example.com",
    threadId: "thread-123",
    messageId: "msg-456",
  });

  assertEquals(bus.inboundSize, 0);
});

Deno.test("EmailChannel - processInboundMessage: handles message without subject", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  (channel as any).inboxAddress = "bot@agentmail.to";

  await (channel as any).processInboundMessage({
    from: "user@example.com",
    threadId: "thread-123",
    messageId: "msg-456",
    text: "no subject here",
  });

  assertEquals(bus.inboundSize, 1);
  const msg = await bus.consumeInbound();
  assertEquals(msg.content, "no subject here");
});

Deno.test("EmailChannel - processInboundMessage: maps threadId to chatId", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  (channel as any).inboxAddress = "bot@agentmail.to";

  await (channel as any).processInboundMessage({
    from: "user@example.com",
    threadId: "unique-thread-id",
    messageId: "msg-789",
    text: "thread test",
  });

  const msg = await bus.consumeInbound();
  assertEquals(msg.chatId, "unique-thread-id");
});

Deno.test("EmailChannel - processInboundMessage: stores email metadata", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  (channel as any).inboxAddress = "bot@agentmail.to";

  await (channel as any).processInboundMessage({
    from: "user@example.com",
    threadId: "thread-123",
    messageId: "msg-456",
    subject: "Test",
    text: "metadata test",
    to: ["bot@agentmail.to"],
  });

  const msg = await bus.consumeInbound();
  const emailMeta = msg.metadata.email as Record<string, unknown>;
  assertEquals(emailMeta.messageId, "msg-456");
  assertEquals(emailMeta.threadId, "thread-123");
  assertEquals(emailMeta.subject, "Test");
  assertEquals(emailMeta.from, "user@example.com");
});

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

Deno.test("EmailChannel - send: replies to existing thread with messageId", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  let replyCalled: any = null;
  (channel as any).inboxId = "inbox-1";
  (channel as any).client = {
    inboxes: {
      messages: {
        reply: async (inboxId: string, msgId: string, opts: any) => {
          replyCalled = { inboxId, msgId, opts };
        },
        send: async () => {},
      },
    },
  };

  await channel.send({
    channel: "email",
    chatId: "thread-123",
    content: "reply content",
    media: [],
    metadata: {
      email: {
        messageId: "msg-456",
        threadId: "thread-123",
        subject: "Re: Test",
      },
    },
  });

  assertEquals(replyCalled.inboxId, "inbox-1");
  assertEquals(replyCalled.msgId, "msg-456");
  assertEquals(replyCalled.opts.text, "reply content");
  assertEquals(typeof replyCalled.opts.html, "string");
});

Deno.test("EmailChannel - send: sends new message when no messageId", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  let sendCalled: any = null;
  (channel as any).inboxId = "inbox-1";
  (channel as any).client = {
    inboxes: {
      messages: {
        reply: async () => {},
        send: async (inboxId: string, opts: any) => {
          sendCalled = { inboxId, opts };
        },
      },
    },
  };

  await channel.send({
    channel: "email",
    chatId: "recipient@example.com",
    content: "new message",
    media: [],
    metadata: {},
  });

  assertEquals(sendCalled.inboxId, "inbox-1");
  assertEquals(sendCalled.opts.to[0], "recipient@example.com");
  assertEquals(sendCalled.opts.subject, "Message from assistant");
  assertEquals(sendCalled.opts.text, "new message");
});

Deno.test("EmailChannel - send: handles missing client gracefully", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  // client is null by default, should not throw
  await channel.send({
    channel: "email",
    chatId: "thread-123",
    content: "hello",
    media: [],
    metadata: {},
  });
  // If we get here without throwing, the test passes
});

Deno.test("EmailChannel - send: handles missing email metadata", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  let sendCalled: any = null;
  (channel as any).inboxId = "inbox-1";
  (channel as any).client = {
    inboxes: {
      messages: {
        reply: async () => {},
        send: async (inboxId: string, opts: any) => {
          sendCalled = { inboxId, opts };
        },
      },
    },
  };

  await channel.send({
    channel: "email",
    chatId: "recipient@example.com",
    content: "no metadata",
    media: [],
    metadata: {},
  });

  assertEquals(sendCalled.inboxId, "inbox-1");
  assertEquals(sendCalled.opts.subject, "Message from assistant");
});

Deno.test("EmailChannel - send: includes both text and html in reply", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  let replyCalled: any = null;
  (channel as any).inboxId = "inbox-1";
  (channel as any).client = {
    inboxes: {
      messages: {
        reply: async (_inboxId: string, _msgId: string, opts: any) => {
          replyCalled = opts;
        },
        send: async () => {},
      },
    },
  };

  await channel.send({
    channel: "email",
    chatId: "thread-123",
    content: "**bold** reply",
    media: [],
    metadata: {
      email: { messageId: "msg-1", threadId: "thread-123" },
    },
  });

  assertEquals(replyCalled.text, "**bold** reply");
  assertEquals(replyCalled.html.includes("<strong>bold</strong>"), true);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

Deno.test("EmailChannel - stop: sets _running to false", async () => {
  const bus = new MessageBus();
  const channel = new EmailChannel(makeConfig(), bus);
  (channel as any)._running = true;
  assertEquals(channel.isRunning, true);
  await channel.stop();
  assertEquals(channel.isRunning, false);
});
