// deno-lint-ignore-file no-explicit-any require-await
import { assertEquals } from "@std/assert";
import { MessageBus } from "../bus/queue.ts";
import { SlackChannel } from "./slack.ts";
import type { SlackConfig } from "./slack.ts";

function makeConfig(overrides: Partial<SlackConfig> = {}): SlackConfig {
  return {
    botToken: "xoxb-test",
    appToken: "xapp-test",
    groupPolicy: "mention",
    groupAllowFrom: [],
    dm: { enabled: true, policy: "open", allowFrom: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isAllowed
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - isAllowed: DM allowed when dm.enabled=true and policy=open", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  const result = (channel as any).isAllowed("U_USER", "D_DM", "im");
  assertEquals(result, true);
});

Deno.test("SlackChannel - isAllowed: DM denied when dm.enabled=false", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ dm: { enabled: false, policy: "open", allowFrom: [] } }),
    bus,
  );
  const result = (channel as any).isAllowed("U_USER", "D_DM", "im");
  assertEquals(result, false);
});

Deno.test("SlackChannel - isAllowed: DM allowlist denied when sender not in list", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({
      dm: { enabled: true, policy: "allowlist", allowFrom: ["U_ALLOWED"] },
    }),
    bus,
  );
  const result = (channel as any).isAllowed("U_OTHER", "D_DM", "im");
  assertEquals(result, false);
});

Deno.test("SlackChannel - isAllowed: DM allowlist allowed when sender in list", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({
      dm: { enabled: true, policy: "allowlist", allowFrom: ["U_ALLOWED"] },
    }),
    bus,
  );
  const result = (channel as any).isAllowed("U_ALLOWED", "D_DM", "im");
  assertEquals(result, true);
});

Deno.test("SlackChannel - isAllowed: group open policy allows any channel", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ groupPolicy: "open" }),
    bus,
  );
  const result = (channel as any).isAllowed("U_USER", "C_CHAN", "channel");
  assertEquals(result, true);
});

Deno.test("SlackChannel - isAllowed: group allowlist allowed when chatId in list", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({
      groupPolicy: "allowlist",
      groupAllowFrom: ["C_CHAN"],
    }),
    bus,
  );
  const result = (channel as any).isAllowed("U_USER", "C_CHAN", "channel");
  assertEquals(result, true);
});

Deno.test("SlackChannel - isAllowed: group allowlist denied when chatId not in list", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({
      groupPolicy: "allowlist",
      groupAllowFrom: ["C_OTHER"],
    }),
    bus,
  );
  const result = (channel as any).isAllowed("U_USER", "C_CHAN", "channel");
  assertEquals(result, false);
});

Deno.test("SlackChannel - isAllowed: group mention policy allows (permission level)", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ groupPolicy: "mention" }),
    bus,
  );
  const result = (channel as any).isAllowed("U_USER", "C_CHAN", "channel");
  assertEquals(result, true);
});

// ---------------------------------------------------------------------------
// shouldRespondInChannel
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - shouldRespondInChannel: open policy returns true", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "open" }), bus);
  const result = (channel as any).shouldRespondInChannel(
    "hello",
    "C_CHAN",
  );
  assertEquals(result, true);
});

Deno.test("SlackChannel - shouldRespondInChannel: mention policy + no bot mention returns false", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  const result = (channel as any).shouldRespondInChannel(
    "hello",
    "C_CHAN",
  );
  assertEquals(result, false);
});

Deno.test("SlackChannel - shouldRespondInChannel: mention policy + text with bot mention returns true", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  (channel as any).botUserId = "U_BOT";
  const result = (channel as any).shouldRespondInChannel(
    "hey <@U_BOT> do stuff",
    "C_CHAN",
  );
  assertEquals(result, true);
});

Deno.test("SlackChannel - shouldRespondInChannel: mention policy + no mention returns false", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  (channel as any).botUserId = "U_BOT";
  const result = (channel as any).shouldRespondInChannel(
    "just chatting",
    "C_CHAN",
  );
  assertEquals(result, false);
});

Deno.test("SlackChannel - shouldRespondInChannel: mention policy + no botUserId returns false", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  // botUserId is null by default
  const result = (channel as any).shouldRespondInChannel(
    "just chatting",
    "C_CHAN",
  );
  assertEquals(result, false);
});

Deno.test("SlackChannel - shouldRespondInChannel: allowlist policy + chatId in list returns true", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ groupPolicy: "allowlist", groupAllowFrom: ["C_CHAN"] }),
    bus,
  );
  const result = (channel as any).shouldRespondInChannel(
    "hello",
    "C_CHAN",
  );
  assertEquals(result, true);
});

Deno.test("SlackChannel - shouldRespondInChannel: allowlist policy + chatId not in list returns false", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ groupPolicy: "allowlist", groupAllowFrom: ["C_OTHER"] }),
    bus,
  );
  const result = (channel as any).shouldRespondInChannel(
    "hello",
    "C_CHAN",
  );
  assertEquals(result, false);
});

// ---------------------------------------------------------------------------
// stripBotMention
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - stripBotMention: strips bot mention from text", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  (channel as any).botUserId = "U_BOT";
  const result = (channel as any).stripBotMention("<@U_BOT> hello");
  assertEquals(result, "hello");
});

Deno.test("SlackChannel - stripBotMention: no mention returns text unchanged", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  (channel as any).botUserId = "U_BOT";
  const result = (channel as any).stripBotMention("hello");
  assertEquals(result, "hello");
});

Deno.test("SlackChannel - stripBotMention: no botUserId returns text unchanged", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  // botUserId is null by default
  const result = (channel as any).stripBotMention("<@U_BOT> hello");
  assertEquals(result, "<@U_BOT> hello");
});

Deno.test("SlackChannel - stripBotMention: empty text returns empty", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  (channel as any).botUserId = "U_BOT";
  const result = (channel as any).stripBotMention("");
  assertEquals(result, "");
});

Deno.test("SlackChannel - stripBotMention: strips multiple mentions", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  (channel as any).botUserId = "U_BOT";
  const result = (channel as any).stripBotMention(
    "<@U_BOT> hello <@U_BOT> world",
  );
  assertEquals(result, "hello world");
});

// ---------------------------------------------------------------------------
// toMrkdwn
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - toMrkdwn: empty string returns empty", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  const result = (channel as any).toMrkdwn("");
  assertEquals(result, "");
});

Deno.test("SlackChannel - toMrkdwn: simple text passes through", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  const result = (channel as any).toMrkdwn("hello world");
  assertEquals(result, "hello world\n");
});

Deno.test("SlackChannel - toMrkdwn: markdown table converts to bullet format", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  const table = `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`;
  const result = (channel as any).toMrkdwn(table);
  // The table should be converted to key-value pairs, not pipe format
  assertEquals(result.includes("|"), false);
  assertEquals(result.includes("Alice"), true);
  assertEquals(result.includes("Bob"), true);
});

// ---------------------------------------------------------------------------
// onSocketEvent
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - onSocketEvent: calls ack immediately", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  let ackCalled = false;
  const ack = async () => {
    ackCalled = true;
  };
  await (channel as any).onSocketEvent(ack, { type: "reaction_added" });
  assertEquals(ackCalled, true);
});

Deno.test("SlackChannel - onSocketEvent: ignores events that are not message type", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, { type: "reaction_added" });
  assertEquals(bus.inboundSize, 0);
});

Deno.test("SlackChannel - onSocketEvent: ignores messages with subtypes", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    subtype: "bot_message",
    user: "U_USER",
    channel: "C_CHAN",
    text: "hello",
  });
  assertEquals(bus.inboundSize, 0);
});

Deno.test("SlackChannel - onSocketEvent: ignores own bot messages", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  (channel as any).botUserId = "U_BOT";
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_BOT",
    channel: "C_CHAN",
    text: "hello",
  });
  assertEquals(bus.inboundSize, 0);
});

Deno.test("SlackChannel - onSocketEvent: processes message with bot mention in channel", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ groupPolicy: "mention" }),
    bus,
  );
  (channel as any).botUserId = "U_BOT";
  (channel as any).webClient = {
    reactions: { add: async () => {} },
  };
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "<@U_BOT> hello",
    ts: "1234.5678",
  });
  assertEquals(bus.inboundSize, 1);
  const msg = await bus.consumeInbound();
  assertEquals(msg.content, "hello");
});

Deno.test("SlackChannel - onSocketEvent: processes valid DM and publishes to bus", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ dm: { enabled: true, policy: "open", allowFrom: [] } }),
    bus,
  );
  (channel as any).botUserId = "U_BOT";
  // Inject mock webClient for reactions.add
  (channel as any).webClient = {
    reactions: {
      add: async () => {},
    },
  };
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "D_DM",
    channel_type: "im",
    text: "hello bot",
    ts: "1234.5678",
  });
  assertEquals(bus.inboundSize, 1);
  const msg = await bus.consumeInbound();
  assertEquals(msg.channel, "slack");
  assertEquals(msg.senderId, "U_USER");
  assertEquals(msg.chatId, "D_DM");
  assertEquals(msg.content, "hello bot");
});

Deno.test("SlackChannel - onSocketEvent: ignores app_mention events (dedup with message)", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ groupPolicy: "mention" }),
    bus,
  );
  (channel as any).botUserId = "U_BOT";
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "app_mention",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "<@U_BOT> do something",
    ts: "1234.5678",
  });
  assertEquals(bus.inboundSize, 0);
});

Deno.test("SlackChannel - onSocketEvent: adds eyes reaction (best-effort)", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  (channel as any).botUserId = "U_BOT";
  let reactionAdded = false;
  (channel as any).webClient = {
    reactions: {
      add: async (opts: any) => {
        reactionAdded = true;
        assertEquals(opts.name, "eyes");
        assertEquals(opts.channel, "D_DM");
        assertEquals(opts.timestamp, "1234.5678");
      },
    },
  };
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "D_DM",
    channel_type: "im",
    text: "hello",
    ts: "1234.5678",
  });
  assertEquals(reactionAdded, true);
});

Deno.test("SlackChannel - onSocketEvent: ignores events with no senderId or chatId", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  const ack = async () => {};
  // Missing user
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    channel: "C_CHAN",
    text: "hello",
  });
  assertEquals(bus.inboundSize, 0);
  // Missing channel
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    text: "hello",
  });
  assertEquals(bus.inboundSize, 0);
});

Deno.test("SlackChannel - onSocketEvent: denied by isAllowed skips publishing", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ dm: { enabled: false, policy: "open", allowFrom: [] } }),
    bus,
  );
  (channel as any).botUserId = "U_BOT";
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "D_DM",
    channel_type: "im",
    text: "hello",
    ts: "1234.5678",
  });
  assertEquals(bus.inboundSize, 0);
});

Deno.test("SlackChannel - onSocketEvent: denied by shouldRespondInChannel skips publishing", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ groupPolicy: "mention" }),
    bus,
  );
  (channel as any).botUserId = "U_BOT";
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "no mention here",
    ts: "1234.5678",
  });
  assertEquals(bus.inboundSize, 0);
});

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - send: posts message with chat.postMessage", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  let posted: any = null;
  (channel as any).webClient = {
    chat: {
      postMessage: async (opts: any) => {
        posted = opts;
      },
    },
  };
  await channel.send({
    channel: "slack",
    chatId: "C_CHAN",
    content: "hello",
    media: [],
    metadata: {
      slack: { thread_ts: "1234.5678", channel_type: "channel" },
    },
  });
  assertEquals(posted.channel, "C_CHAN");
  assertEquals(posted.thread_ts, "1234.5678");
});

Deno.test("SlackChannel - send: uses thread_ts for channel messages", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  let posted: any = null;
  (channel as any).webClient = {
    chat: {
      postMessage: async (opts: any) => {
        posted = opts;
      },
    },
  };
  await channel.send({
    channel: "slack",
    chatId: "C_CHAN",
    content: "threaded reply",
    media: [],
    metadata: {
      slack: { thread_ts: "111.222", channel_type: "channel" },
    },
  });
  assertEquals(posted.thread_ts, "111.222");
});

Deno.test("SlackChannel - send: omits thread_ts for DMs (channel_type=im)", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  let posted: any = null;
  (channel as any).webClient = {
    chat: {
      postMessage: async (opts: any) => {
        posted = opts;
      },
    },
  };
  await channel.send({
    channel: "slack",
    chatId: "D_DM",
    content: "dm reply",
    media: [],
    metadata: {
      slack: { thread_ts: "111.222", channel_type: "im" },
    },
  });
  assertEquals(posted.thread_ts, undefined);
});

Deno.test("SlackChannel - send: handles missing webClient gracefully", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  // webClient is null by default, should not throw
  await channel.send({
    channel: "slack",
    chatId: "C_CHAN",
    content: "hello",
    media: [],
    metadata: {},
  });
  // If we get here without throwing, the test passes
});

Deno.test("SlackChannel - send: handles missing slack metadata", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  let posted: any = null;
  (channel as any).webClient = {
    chat: {
      postMessage: async (opts: any) => {
        posted = opts;
      },
    },
  };
  await channel.send({
    channel: "slack",
    chatId: "C_CHAN",
    content: "no metadata",
    media: [],
    metadata: {},
  });
  assertEquals(posted.channel, "C_CHAN");
  assertEquals(posted.thread_ts, undefined);
});

// ---------------------------------------------------------------------------
// Thread monitoring
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - trackThread/isThreadActive: tracks and detects active threads", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  assertEquals((channel as any).isThreadActive("1111.2222"), false);
  (channel as any).trackThread("1111.2222");
  assertEquals((channel as any).isThreadActive("1111.2222"), true);
});

Deno.test("SlackChannel - isThreadActive: expired thread returns false", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  (channel as any)._activeThreads.set("1111.2222", Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
  assertEquals((channel as any).isThreadActive("1111.2222"), false);
  // Should also be removed from the map
  assertEquals((channel as any)._activeThreads.has("1111.2222"), false);
});

Deno.test("SlackChannel - pruneExpiredThreads: removes expired entries", () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  (channel as any)._activeThreads.set("fresh", Date.now());
  (channel as any)._activeThreads.set("stale", Date.now() - 3 * 60 * 60 * 1000);
  (channel as any).pruneExpiredThreads();
  assertEquals((channel as any)._activeThreads.has("fresh"), true);
  assertEquals((channel as any)._activeThreads.has("stale"), false);
});

Deno.test("SlackChannel - onSocketEvent: top-level mention tracks thread using message ts", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  (channel as any).botUserId = "U_BOT";
  (channel as any).webClient = { reactions: { add: async () => {} } };
  const ack = async () => {};
  // Top-level message: no thread_ts, only ts
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "<@U_BOT> help me",
    ts: "1234.5678",
  });
  assertEquals(bus.inboundSize, 1);
  // Thread should be tracked using the message's ts (effectiveThreadTs)
  assertEquals((channel as any)._activeThreads.has("1234.5678"), true);
});

Deno.test("SlackChannel - onSocketEvent: mention in thread tracks thread", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  (channel as any).botUserId = "U_BOT";
  (channel as any).webClient = { reactions: { add: async () => {} } };
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "<@U_BOT> help me",
    ts: "2222.3333",
    thread_ts: "1111.2222",
  });
  assertEquals(bus.inboundSize, 1);
  assertEquals((channel as any)._activeThreads.has("1111.2222"), true);
});

Deno.test("SlackChannel - onSocketEvent: active thread without mention forwards with threadMonitored", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  (channel as any).botUserId = "U_BOT";
  (channel as any).webClient = { reactions: { add: async () => {} } };
  // Pre-track the thread
  (channel as any).trackThread("1111.2222");
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "can you also check the logs?",
    ts: "3333.4444",
    thread_ts: "1111.2222",
  });
  assertEquals(bus.inboundSize, 1);
  const msg = await bus.consumeInbound();
  assertEquals(msg.content, "can you also check the logs?");
  const slack = msg.metadata.slack as Record<string, unknown>;
  assertEquals(slack.threadMonitored, true);
});

Deno.test("SlackChannel - onSocketEvent: unknown thread without mention is dropped", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  (channel as any).botUserId = "U_BOT";
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "random thread message",
    ts: "3333.4444",
    thread_ts: "9999.0000",
  });
  assertEquals(bus.inboundSize, 0);
});

Deno.test("SlackChannel - onSocketEvent: open policy still responds without mention (no regression)", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "open" }), bus);
  (channel as any).botUserId = "U_BOT";
  (channel as any).webClient = { reactions: { add: async () => {} } };
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "hello everyone",
    ts: "1234.5678",
  });
  assertEquals(bus.inboundSize, 1);
  const msg = await bus.consumeInbound();
  assertEquals(msg.content, "hello everyone");
  const slack = msg.metadata.slack as Record<string, unknown>;
  assertEquals(slack.threadMonitored, undefined);
});

Deno.test("SlackChannel - onSocketEvent: eyes reaction skipped for threadMonitored messages", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig({ groupPolicy: "mention" }), bus);
  (channel as any).botUserId = "U_BOT";
  let reactionCalled = false;
  (channel as any).webClient = {
    reactions: { add: async () => { reactionCalled = true; } },
  };
  // Pre-track the thread
  (channel as any).trackThread("1111.2222");
  const ack = async () => {};
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "C_CHAN",
    channel_type: "channel",
    text: "follow up without mention",
    ts: "3333.4444",
    thread_ts: "1111.2222",
  });
  assertEquals(reactionCalled, false);
  assertEquals(bus.inboundSize, 1);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - stop: sets _running to false", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(makeConfig(), bus);
  // Manually set _running to true without calling start() (which needs real Slack tokens)
  (channel as any)._running = true;
  assertEquals(channel.isRunning, true);
  // stop() tries to disconnect socketClient but it's null, should be fine
  await channel.stop();
  assertEquals(channel.isRunning, false);
});

// ---------------------------------------------------------------------------
// Error resilience
// ---------------------------------------------------------------------------

Deno.test("SlackChannel - onSocketEvent: ack failure does not prevent message processing", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ dm: { enabled: true, policy: "open", allowFrom: [] } }),
    bus,
  );
  (channel as any).botUserId = "U_BOT";
  (channel as any).webClient = {
    reactions: { add: async () => {} },
  };

  const ack = async () => {
    throw new Error("ack failed");
  };

  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "D_DM",
    channel_type: "im",
    text: "hello",
    ts: "1234.5678",
  });

  // Message should still be published despite ack failure
  assertEquals(bus.inboundSize, 1);
  const msg = await bus.consumeInbound();
  assertEquals(msg.content, "hello");
});

Deno.test("SlackChannel - onSocketEvent: processing error does not propagate", async () => {
  const bus = new MessageBus();
  const channel = new SlackChannel(
    makeConfig({ dm: { enabled: true, policy: "open", allowFrom: [] } }),
    bus,
  );
  (channel as any).botUserId = "U_BOT";
  // webClient.reactions.add throws to simulate mid-processing error
  (channel as any).webClient = {
    reactions: {
      add: async () => {
        throw new Error("reactions failed");
      },
    },
  };

  const ack = async () => {};

  // Should not throw — error is caught internally
  await (channel as any).onSocketEvent(ack, {
    type: "message",
    user: "U_USER",
    channel: "D_DM",
    channel_type: "im",
    text: "hello",
    ts: "1234.5678",
  });

  // Message should still be published (reactions.add failure is best-effort)
  assertEquals(bus.inboundSize, 1);
});
