import { assertEquals } from "@std/assert";
import { parseCliArgs } from "./mod.ts";

Deno.test("parseCliArgs - no args defaults to gateway", () => {
  const result = parseCliArgs([]);
  assertEquals(result, { command: "gateway" });
});

Deno.test("parseCliArgs - 'gateway' returns gateway command", () => {
  const result = parseCliArgs(["gateway"]);
  assertEquals(result, { command: "gateway" });
});

Deno.test("parseCliArgs - 'agent' returns agent command with empty options", () => {
  const result = parseCliArgs(["agent"]);
  assertEquals(result, { command: "agent", options: {} });
});

Deno.test("parseCliArgs - 'agent -m hello' returns agent with message", () => {
  const result = parseCliArgs(["agent", "-m", "hello"]);
  assertEquals(result, { command: "agent", options: { message: "hello" } });
});

Deno.test("parseCliArgs - 'agent --message hello' returns agent with message", () => {
  const result = parseCliArgs(["agent", "--message", "hello"]);
  assertEquals(result, { command: "agent", options: { message: "hello" } });
});

Deno.test("parseCliArgs - 'agent --session my-session' returns agent with session", () => {
  const result = parseCliArgs(["agent", "--session", "my-session"]);
  assertEquals(result, { command: "agent", options: { session: "my-session" } });
});

Deno.test("parseCliArgs - 'agent -s my-session' returns agent with session", () => {
  const result = parseCliArgs(["agent", "-s", "my-session"]);
  assertEquals(result, { command: "agent", options: { session: "my-session" } });
});

Deno.test("parseCliArgs - 'agent -m hello -s sess' returns both options", () => {
  const result = parseCliArgs(["agent", "-m", "hello", "-s", "sess"]);
  assertEquals(result, {
    command: "agent",
    options: { message: "hello", session: "sess" },
  });
});

Deno.test("parseCliArgs - 'status' returns status command", () => {
  const result = parseCliArgs(["status"]);
  assertEquals(result, { command: "status" });
});

Deno.test("parseCliArgs - 'onboard' returns onboard command", () => {
  const result = parseCliArgs(["onboard"]);
  assertEquals(result, { command: "onboard" });
});

Deno.test("parseCliArgs - '--help' returns null", () => {
  const result = parseCliArgs(["--help"]);
  assertEquals(result, null);
});

Deno.test("parseCliArgs - '-h' returns null", () => {
  const result = parseCliArgs(["-h"]);
  assertEquals(result, null);
});

Deno.test("parseCliArgs - unknown command returns null", () => {
  const result = parseCliArgs(["unknown"]);
  assertEquals(result, null);
});
