import { assertEquals, assertStringIncludes } from "@std/assert";
import { stub } from "jsr:@std/testing/mock";
import { TtsTool } from "./tts.ts";
import type { Storage } from "../../storage/base.ts";

function mockStorage(): Storage {
  return {
    upload: async (_key: string, _data: Uint8Array, _ct: string) =>
      "https://s3.example.com/audio/test.opus",
    uploadFromDataUri: async (_key: string, _uri: string) =>
      "https://s3.example.com/audio/test.opus",
    uploadFromUrl: async (_key: string, _url: string) =>
      "https://s3.example.com/audio/test.opus",
    getUrl: (_key: string) => "https://s3.example.com/audio/test.opus",
    delete: async () => {},
    exists: async () => false,
    generateKey: (_prefix: string, ext: string) => `audio/test.${ext}`,
  };
}

function makeTool(): TtsTool {
  return new TtsTool("test-api-key", "openai/tts-1", mockStorage());
}

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

Deno.test("TtsTool - has correct name and required fields", () => {
  const tool = makeTool();
  assertEquals(tool.name, "text_to_speech");
  // deno-lint-ignore no-explicit-any
  assertEquals((tool.parameters as any).required, ["text"]);
});

// ---------------------------------------------------------------------------
// Missing text
// ---------------------------------------------------------------------------

Deno.test("TtsTool - returns error when text is missing", async () => {
  const tool = makeTool();
  const result = await tool.execute({});
  assertEquals(result, "Error: text is required.");
});

Deno.test("TtsTool - returns error when text is empty string", async () => {
  const tool = makeTool();
  const result = await tool.execute({ text: "" });
  assertEquals(result, "Error: text is required.");
});

// ---------------------------------------------------------------------------
// Successful response
// ---------------------------------------------------------------------------

Deno.test("TtsTool - successful response uploads audio and returns URL", async () => {
  const tool = makeTool();

  const audioData = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // fake opus header
  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response(audioData.buffer, {
          status: 200,
          headers: { "content-type": "audio/opus" },
        }),
      );
    },
  );

  try {
    const result = await tool.execute({ text: "Hello world" });
    assertStringIncludes(result, "Speech generated and uploaded:");
    assertStringIncludes(result, "https://s3.example.com/audio/test.opus");
  } finally {
    fetchStub.restore();
  }
});

Deno.test("TtsTool - uses provided voice parameter", async () => {
  const tool = makeTool();
  let capturedBody = "";

  const fetchStub = stub(
    globalThis,
    "fetch",
    async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body ? String(init.body) : "";
      return new Response(new Uint8Array([1, 2, 3]).buffer, {
        status: 200,
        headers: { "content-type": "audio/opus" },
      });
    },
  );

  try {
    await tool.execute({ text: "Hello", voice: "nova" });
    assertStringIncludes(capturedBody, '"voice":"nova"');
  } finally {
    fetchStub.restore();
  }
});

// ---------------------------------------------------------------------------
// API error response
// ---------------------------------------------------------------------------

Deno.test("TtsTool - API error returns error message with status", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response("quota exceeded", { status: 429 }),
      );
    },
  );

  try {
    const result = await tool.execute({ text: "Hello" });
    assertStringIncludes(result, "Error generating speech:");
    assertStringIncludes(result, "429");
  } finally {
    fetchStub.restore();
  }
});

// ---------------------------------------------------------------------------
// Fetch failure (network error)
// ---------------------------------------------------------------------------

Deno.test("TtsTool - fetch failure returns error message", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.reject(new Error("connection refused"));
    },
  );

  try {
    const result = await tool.execute({ text: "Hello" });
    assertStringIncludes(result, "Error generating speech:");
    assertStringIncludes(result, "connection refused");
  } finally {
    fetchStub.restore();
  }
});
