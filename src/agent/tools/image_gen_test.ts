import { assertEquals, assertStringIncludes } from "@std/assert";
import { stub } from "jsr:@std/testing/mock";
import { ImageGenTool } from "./image_gen.ts";
import type { Storage } from "../../storage/base.ts";

function mockStorage(): Storage {
  return {
    upload: async (_key: string, _data: Uint8Array, _ct: string) =>
      "https://s3.example.com/images/test.png",
    uploadFromDataUri: async (_key: string, _uri: string) =>
      "https://s3.example.com/images/test.png",
    uploadFromUrl: async (_key: string, _url: string) =>
      "https://s3.example.com/images/test.png",
    getUrl: (_key: string) => "https://s3.example.com/images/test.png",
    delete: async () => {},
    exists: async () => false,
    generateKey: (_prefix: string, ext: string) => `images/test.${ext}`,
  };
}

function makeTool(): ImageGenTool {
  return new ImageGenTool("test-api-key", "openai/dall-e-3", mockStorage());
}

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - has correct name and required fields", () => {
  const tool = makeTool();
  assertEquals(tool.name, "generate_image");
  // deno-lint-ignore no-explicit-any
  assertEquals((tool.parameters as any).required, ["prompt"]);
});

// ---------------------------------------------------------------------------
// Missing prompt
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - returns error when prompt is missing", async () => {
  const tool = makeTool();
  const result = await tool.execute({});
  assertEquals(result, "Error: prompt is required.");
});

Deno.test("ImageGenTool - returns error when prompt is empty string", async () => {
  const tool = makeTool();
  const result = await tool.execute({ prompt: "" });
  assertEquals(result, "Error: prompt is required.");
});

// ---------------------------------------------------------------------------
// Successful base64 response
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - b64_json response uploads to storage and returns URL", async () => {
  const tool = makeTool();

  // Small valid base64 (3 bytes -> "AAEC")
  const b64 = btoa(String.fromCharCode(0, 1, 2));
  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ b64_json: b64 }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    },
  );

  try {
    const result = await tool.execute({ prompt: "a red circle" });
    assertStringIncludes(result, "Image generated and uploaded:");
    assertStringIncludes(result, "https://s3.example.com/images/test.png");
  } finally {
    fetchStub.restore();
  }
});

// ---------------------------------------------------------------------------
// Successful URL response
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - url response downloads and uploads to storage", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ url: "https://cdn.openai.com/img.png" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    },
  );

  try {
    const result = await tool.execute({ prompt: "a blue square" });
    assertStringIncludes(result, "Image generated and uploaded:");
    assertStringIncludes(result, "https://s3.example.com/images/test.png");
  } finally {
    fetchStub.restore();
  }
});

// ---------------------------------------------------------------------------
// API error response
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - API error returns error message with status", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response("invalid api key", { status: 401 }),
      );
    },
  );

  try {
    const result = await tool.execute({ prompt: "test" });
    assertStringIncludes(result, "Error generating image:");
    assertStringIncludes(result, "401");
  } finally {
    fetchStub.restore();
  }
});

// ---------------------------------------------------------------------------
// Fetch failure (network error)
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - fetch failure returns error message", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.reject(new Error("network timeout"));
    },
  );

  try {
    const result = await tool.execute({ prompt: "test" });
    assertStringIncludes(result, "Error generating image:");
    assertStringIncludes(result, "network timeout");
  } finally {
    fetchStub.restore();
  }
});

// ---------------------------------------------------------------------------
// No image data in response
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - empty data array returns error", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    },
  );

  try {
    const result = await tool.execute({ prompt: "test" });
    assertEquals(result, "Error: No image data in response.");
  } finally {
    fetchStub.restore();
  }
});
