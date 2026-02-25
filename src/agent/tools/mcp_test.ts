import { assertEquals, assertStringIncludes } from "@std/assert";
import { ToolRegistry } from "./base.ts";
import { MCPToolWrapper, loadMcpConfig, saveMcpConfig } from "./mcp.ts";
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

Deno.test("loadMcpConfig - returns defaults when file missing", async () => {
  const result = await loadMcpConfig("/nonexistent/path");
  assertEquals(result, { exa: { url: "https://mcp.exa.ai/mcp" } });
});

Deno.test("loadMcpConfig - merges user config with defaults", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const config = {
    myserver: { command: "npx", args: ["some-server"] },
    remote: { url: "http://localhost:3000/mcp" },
  };
  Deno.writeTextFileSync(join(tmpDir, "mcp_servers.json"), JSON.stringify(config));
  const result = await loadMcpConfig(tmpDir);
  assertEquals(result, { exa: { url: "https://mcp.exa.ai/mcp" }, ...config });
});

// --- loadMcpConfig with new fields ---

Deno.test("loadMcpConfig - loads config with headers field", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const config = {
    remote: {
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer test-token" },
    },
  };
  Deno.writeTextFileSync(join(tmpDir, "mcp_servers.json"), JSON.stringify(config));
  const result = await loadMcpConfig(tmpDir);
  assertEquals(result.remote.headers, { Authorization: "Bearer test-token" });
});

Deno.test("loadMcpConfig - loads config with transport field", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const config = {
    remote: {
      url: "https://example.com/mcp",
      transport: "sse",
    },
  };
  Deno.writeTextFileSync(join(tmpDir, "mcp_servers.json"), JSON.stringify(config));
  const result = await loadMcpConfig(tmpDir);
  assertEquals(result.remote.transport, "sse");
});

Deno.test("loadMcpConfig - loads config with oauth field", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const config = {
    remote: {
      url: "https://example.com/mcp",
      oauth: {
        tokens: { access_token: "abc", token_type: "Bearer" },
        clientInformation: { client_id: "test-client" },
      },
    },
  };
  Deno.writeTextFileSync(join(tmpDir, "mcp_servers.json"), JSON.stringify(config));
  const result = await loadMcpConfig(tmpDir);
  assertEquals(result.remote.oauth?.tokens?.access_token, "abc");
  assertEquals(result.remote.oauth?.clientInformation?.client_id, "test-client");
});

// --- saveMcpConfig tests ---

Deno.test("saveMcpConfig - writes valid JSON to disk", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const servers = {
    myserver: { url: "https://example.com/mcp", headers: { "X-Key": "val" } },
  };
  await saveMcpConfig(tmpDir, servers);
  const text = Deno.readTextFileSync(join(tmpDir, "mcp_servers.json"));
  const parsed = JSON.parse(text);
  assertEquals(parsed.myserver.url, "https://example.com/mcp");
  assertEquals(parsed.myserver.headers, { "X-Key": "val" });
});

Deno.test("saveMcpConfig - excludes default servers that haven't changed", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const servers = {
    exa: { url: "https://mcp.exa.ai/mcp" },
    custom: { url: "https://custom.example.com/mcp" },
  };
  await saveMcpConfig(tmpDir, servers);
  const text = Deno.readTextFileSync(join(tmpDir, "mcp_servers.json"));
  const parsed = JSON.parse(text);
  assertEquals(parsed.exa, undefined);
  assertEquals(parsed.custom.url, "https://custom.example.com/mcp");
});

Deno.test("saveMcpConfig - preserves modified default servers", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const servers = {
    exa: { url: "https://mcp.exa.ai/mcp", headers: { "X-Key": "custom" } },
  };
  await saveMcpConfig(tmpDir, servers);
  const text = Deno.readTextFileSync(join(tmpDir, "mcp_servers.json"));
  const parsed = JSON.parse(text);
  assertEquals(parsed.exa.headers, { "X-Key": "custom" });
});

Deno.test("saveMcpConfig - preserves existing entries when updating one", async () => {
  const tmpDir = Deno.makeTempDirSync();
  const initial = {
    server1: { url: "https://s1.example.com/mcp" },
    server2: { url: "https://s2.example.com/mcp" },
  };
  await saveMcpConfig(tmpDir, initial);

  const loaded = await loadMcpConfig(tmpDir);
  loaded.server3 = { url: "https://s3.example.com/mcp" };
  await saveMcpConfig(tmpDir, loaded);

  const text = Deno.readTextFileSync(join(tmpDir, "mcp_servers.json"));
  const parsed = JSON.parse(text);
  assertEquals(parsed.server1.url, "https://s1.example.com/mcp");
  assertEquals(parsed.server2.url, "https://s2.example.com/mcp");
  assertEquals(parsed.server3.url, "https://s3.example.com/mcp");
});
