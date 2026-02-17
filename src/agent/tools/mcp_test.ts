import { assertEquals, assertStringIncludes } from "@std/assert";
import { ToolRegistry } from "./base.ts";
import { MCPToolWrapper, loadMcpConfig } from "./mcp.ts";
import { join } from "@std/path";

// Mock client that records callTool invocations
function mockClient(content: Array<{ type: string; text?: string }>) {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  return {
    calls,
    callTool(req: { name: string; arguments?: Record<string, unknown> }) {
      calls.push({ name: req.name, arguments: req.arguments ?? {} });
      return Promise.resolve({ content });
    },
  };
}

// --- MCPToolWrapper tests ---

Deno.test("MCPToolWrapper - namespaces tool name as mcp_{server}_{tool}", () => {
  const client = mockClient([]);
  const wrapper = new MCPToolWrapper(client, "myserver", { name: "do_stuff" });
  assertEquals(wrapper.name, "mcp_myserver_do_stuff");
});

Deno.test("MCPToolWrapper - uses description from tool def", () => {
  const client = mockClient([]);
  const wrapper = new MCPToolWrapper(client, "s", {
    name: "t",
    description: "A great tool",
  });
  assertEquals(wrapper.description, "A great tool");
});

Deno.test("MCPToolWrapper - falls back to name when no description", () => {
  const client = mockClient([]);
  const wrapper = new MCPToolWrapper(client, "s", { name: "fallback_tool" });
  assertEquals(wrapper.description, "fallback_tool");
});

Deno.test("MCPToolWrapper - uses inputSchema as parameters", () => {
  const client = mockClient([]);
  const schema = { type: "object", properties: { q: { type: "string" } } };
  const wrapper = new MCPToolWrapper(client, "s", {
    name: "t",
    inputSchema: schema,
  });
  assertEquals(wrapper.parameters, schema);
});

Deno.test("MCPToolWrapper - defaults parameters when no inputSchema", () => {
  const client = mockClient([]);
  const wrapper = new MCPToolWrapper(client, "s", { name: "t" });
  assertEquals(wrapper.parameters, { type: "object", properties: {} });
});

Deno.test("MCPToolWrapper - execute calls client.callTool with original name", async () => {
  const client = mockClient([{ type: "text", text: "ok" }]);
  const wrapper = new MCPToolWrapper(client, "srv", { name: "original_name" });
  await wrapper.execute({ foo: "bar" });
  assertEquals(client.calls.length, 1);
  assertEquals(client.calls[0].name, "original_name");
  assertEquals(client.calls[0].arguments, { foo: "bar" });
});

Deno.test("MCPToolWrapper - execute extracts text from TextContent blocks", async () => {
  const client = mockClient([
    { type: "text", text: "hello" },
    { type: "text", text: "world" },
  ]);
  const wrapper = new MCPToolWrapper(client, "s", { name: "t" });
  const result = await wrapper.execute({});
  assertEquals(result, "hello\nworld");
});

Deno.test("MCPToolWrapper - execute returns '(no output)' for empty content", async () => {
  const client = mockClient([]);
  const wrapper = new MCPToolWrapper(client, "s", { name: "t" });
  const result = await wrapper.execute({});
  assertEquals(result, "(no output)");
});

Deno.test("MCPToolWrapper - execute stringifies non-text blocks", async () => {
  const client = mockClient([
    { type: "image", text: undefined },
    { type: "text", text: "after" },
  ]);
  const wrapper = new MCPToolWrapper(client, "s", { name: "t" });
  const result = await wrapper.execute({});
  assertStringIncludes(result, "image");
  assertStringIncludes(result, "after");
});

Deno.test("MCPToolWrapper - integrates with ToolRegistry", async () => {
  const client = mockClient([{ type: "text", text: "registered" }]);
  const wrapper = new MCPToolWrapper(client, "srv", {
    name: "mytool",
    description: "desc",
  });
  const registry = new ToolRegistry();
  registry.register(wrapper);
  assertEquals(registry.get("mcp_srv_mytool")?.name, "mcp_srv_mytool");
  const result = await registry.execute("mcp_srv_mytool", {});
  assertEquals(result, "registered");
});

// --- loadMcpConfig tests ---

Deno.test("loadMcpConfig - returns empty object when file missing", async () => {
  const result = await loadMcpConfig("/nonexistent/path");
  assertEquals(result, {});
});

Deno.test("loadMcpConfig - parses valid JSON config", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const config = {
    myserver: { command: "npx", args: ["some-server"] },
    remote: { url: "http://localhost:3000/mcp" },
  };
  Deno.writeTextFileSync(join(tmpDir, "mcp_servers.json"), JSON.stringify(config));
  const result = await loadMcpConfig(tmpDir);
  assertEquals(result, config);
});
