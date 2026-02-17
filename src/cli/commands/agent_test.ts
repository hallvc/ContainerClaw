import { assertEquals } from "@std/assert";
import { processInput } from "./agent.ts";

// ---------------------------------------------------------------------------
// processInput tests (pure function — no IO)
// ---------------------------------------------------------------------------

Deno.test("processInput - /quit returns quit action", () => {
  const result = processInput("/quit");
  assertEquals(result, { action: "quit" });
});

Deno.test("processInput - /exit returns quit action", () => {
  const result = processInput("/exit");
  assertEquals(result, { action: "quit" });
});

Deno.test("processInput - exit returns quit action", () => {
  const result = processInput("exit");
  assertEquals(result, { action: "quit" });
});

Deno.test("processInput - quit returns quit action", () => {
  const result = processInput("quit");
  assertEquals(result, { action: "quit" });
});

Deno.test("processInput - :q returns quit action", () => {
  const result = processInput(":q");
  assertEquals(result, { action: "quit" });
});

Deno.test("processInput - empty string returns skip action", () => {
  const result = processInput("");
  assertEquals(result, { action: "skip" });
});

Deno.test("processInput - whitespace-only returns skip action", () => {
  const result = processInput("   ");
  assertEquals(result, { action: "skip" });
});

Deno.test("processInput - /help returns help action with text", () => {
  const result = processInput("/help");
  assertEquals(result.action, "help");
  assertEquals(typeof (result as { action: "help"; text: string }).text, "string");
});

Deno.test("processInput - /new returns clear action", () => {
  const result = processInput("/new");
  assertEquals(result, { action: "clear" });
});

Deno.test("processInput - regular text returns message action", () => {
  const result = processInput("hello world");
  assertEquals(result, { action: "message", content: "hello world" });
});

Deno.test("processInput - trims whitespace from messages", () => {
  const result = processInput("  hello  ");
  assertEquals(result, { action: "message", content: "hello" });
});

Deno.test("processInput - case insensitive quit commands", () => {
  assertEquals(processInput("/QUIT"), { action: "quit" });
  assertEquals(processInput("/Exit"), { action: "quit" });
  assertEquals(processInput("QUIT"), { action: "quit" });
});

Deno.test("processInput - case insensitive help and new", () => {
  assertEquals(processInput("/HELP").action, "help");
  assertEquals(processInput("/NEW"), { action: "clear" });
});

Deno.test("processInput - null input returns quit action", () => {
  const result = processInput(null);
  assertEquals(result, { action: "quit" });
});
