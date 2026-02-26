import { assertEquals, assertStringIncludes } from "@std/assert";
import { stub } from "jsr:@std/testing/mock";
import { ImageGenTool } from "./image_gen.ts";
import { OpenRouterClient } from "../../providers/openrouter_client.ts";
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
  return new ImageGenTool(new OpenRouterClient("test-api-key"), "google/gemini-2.5-flash-image", mockStorage());
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
// Successful image response (data URI in images array)
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - images array response uploads to storage and returns URL", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                images: [{
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,AAEC" },
                }],
              },
            }],
          }),
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
// Successful image response (data URI in content string)
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - data URI in content string uploads to storage", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                content: "data:image/png;base64,AAEC",
              },
            }],
          }),
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
// Sends correct request format
// ---------------------------------------------------------------------------

Deno.test("ImageGenTool - sends chat completions request with modalities", async () => {
  const tool = makeTool();
  let capturedUrl = "";
  let capturedBody = "";

  const fetchStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? "");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                images: [{
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,AAEC" },
                }],
              },
            }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    },
  );

  try {
    await tool.execute({ prompt: "a cat", aspect_ratio: "16:9" });
    assertEquals(capturedUrl, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(capturedBody);
    assertEquals(body.model, "google/gemini-2.5-flash-image");
    assertEquals(body.messages, [{ role: "user", content: "a cat" }]);
    assertEquals(body.modalities, ["image"]);
    assertEquals(body.image_config.aspect_ratio, "16:9");
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

Deno.test("ImageGenTool - empty choices returns error", async () => {
  const tool = makeTool();

  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request): Promise<Response> => {
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "Sorry, I can't do that." } }] }),
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
