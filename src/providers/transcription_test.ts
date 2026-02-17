import { assertEquals } from "@std/assert";
import { transcribe } from "./transcription.ts";

// ---------------------------------------------------------------------------
// Helpers: fetch stubbing (adapted from openrouter_test.ts)
// ---------------------------------------------------------------------------

/** Stub globalThis.fetch with sequential responses (for download + API calls). */
function stubFetchSequence(
  responses: Array<{ body: BodyInit; status?: number }>,
): { calls: Array<{ url: string; init: RequestInit }>; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let callIndex = 0;

  globalThis.fetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    calls.push({ url, init: init ?? {} });
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve(
      new Response(resp.body, {
        status: resp.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Stub globalThis.fetch to throw an error. */
function stubFetchThrow(
  error: Error,
): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> => Promise.reject(error);
  return { restore: () => { globalThis.fetch = original; } };
}

const fakeAudio = new Blob([new Uint8Array([0x4f, 0x67, 0x67, 0x53])]); // OGG magic bytes

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

Deno.test("transcribe - returns transcribed text on success", async () => {
  const stub = stubFetchSequence([
    { body: fakeAudio, status: 200 },
    {
      body: JSON.stringify({
        choices: [{ message: { content: "hello world" } }],
      }),
      status: 200,
    },
  ]);

  try {
    const result = await transcribe("https://example.com/audio.ogg", "sk-or-test");
    assertEquals(result, "hello world");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. Empty API key
// ---------------------------------------------------------------------------

Deno.test("transcribe - returns empty string when API key is empty", async () => {
  const stub = stubFetchSequence([]);

  try {
    const result = await transcribe("https://example.com/audio.ogg", "");
    assertEquals(result, "");
    assertEquals(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. Audio download HTTP error
// ---------------------------------------------------------------------------

Deno.test("transcribe - returns empty string when audio download fails", async () => {
  const stub = stubFetchSequence([
    { body: "Not Found", status: 404 },
  ]);

  try {
    const result = await transcribe("https://example.com/audio.ogg", "sk-or-test");
    assertEquals(result, "");
    assertEquals(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. Audio download network error
// ---------------------------------------------------------------------------

Deno.test("transcribe - returns empty string on network error", async () => {
  const stub = stubFetchThrow(new TypeError("Failed to fetch"));

  try {
    const result = await transcribe("https://example.com/audio.ogg", "sk-or-test");
    assertEquals(result, "");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. OpenRouter API HTTP error
// ---------------------------------------------------------------------------

Deno.test("transcribe - returns empty string when OpenRouter API returns error", async () => {
  const stub = stubFetchSequence([
    { body: fakeAudio, status: 200 },
    { body: JSON.stringify({ error: { message: "Internal Server Error" } }), status: 500 },
  ]);

  try {
    const result = await transcribe("https://example.com/audio.ogg", "sk-or-test");
    assertEquals(result, "");
    assertEquals(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 6. OpenRouter API malformed JSON
// ---------------------------------------------------------------------------

Deno.test("transcribe - returns empty string on malformed JSON response", async () => {
  const stub = stubFetchSequence([
    { body: fakeAudio, status: 200 },
    { body: "not valid json {{{", status: 200 },
  ]);

  try {
    const result = await transcribe("https://example.com/audio.ogg", "sk-or-test");
    assertEquals(result, "");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 7. OpenRouter API empty/null content
// ---------------------------------------------------------------------------

Deno.test("transcribe - returns empty string when content is null", async () => {
  const stub = stubFetchSequence([
    { body: fakeAudio, status: 200 },
    {
      body: JSON.stringify({
        choices: [{ message: { content: null } }],
      }),
      status: 200,
    },
  ]);

  try {
    const result = await transcribe("https://example.com/audio.ogg", "sk-or-test");
    assertEquals(result, "");
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// 8. Correct OpenRouter endpoint, auth, and body structure
// ---------------------------------------------------------------------------

Deno.test("transcribe - sends correct URL, auth header, and input_audio body to OpenRouter", async () => {
  const stub = stubFetchSequence([
    { body: fakeAudio, status: 200 },
    {
      body: JSON.stringify({
        choices: [{ message: { content: "test" } }],
      }),
      status: 200,
    },
  ]);

  try {
    await transcribe("https://example.com/voice/file_0.oga", "sk-or-my-key");

    // First call: audio download
    assertEquals(stub.calls[0].url, "https://example.com/voice/file_0.oga");

    // Second call: OpenRouter API
    assertEquals(
      stub.calls[1].url,
      "https://openrouter.ai/api/v1/chat/completions",
    );
    const headers = stub.calls[1].init.headers as Record<string, string>;
    assertEquals(headers["Authorization"], "Bearer sk-or-my-key");
    assertEquals(headers["Content-Type"], "application/json");
    assertEquals(stub.calls[1].init.method, "POST");

    // Verify body structure
    const body = JSON.parse(stub.calls[1].init.body as string);
    assertEquals(body.model, "google/gemini-2.5-flash");
    assertEquals(Array.isArray(body.messages), true);
    assertEquals(body.messages[0].role, "user");

    const content = body.messages[0].content;
    assertEquals(Array.isArray(content), true);
    assertEquals(content[0].type, "text");
    assertEquals(content[1].type, "input_audio");
    assertEquals(content[1].input_audio.format, "ogg");
    assertEquals(typeof content[1].input_audio.data, "string");
    // Verify it's base64 (non-empty string)
    assertEquals(content[1].input_audio.data.length > 0, true);
  } finally {
    stub.restore();
  }
});
