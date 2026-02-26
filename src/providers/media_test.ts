import { assertEquals, assertRejects } from "@std/assert";
import {
  buildContentParts,
  detectAudioFormat,
  detectMediaType,
  downloadAsBase64,
} from "./media.ts";

// ---------------------------------------------------------------------------
// Helpers: fetch stubbing
// ---------------------------------------------------------------------------

function stubFetch(
  body: BodyInit,
  status = 200,
  headers: Record<string, string> = {},
): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return Promise.resolve(
      new Response(body, {
        status,
        headers: { "Content-Type": "application/octet-stream", ...headers },
      }),
    );
  };
  return { restore: () => { globalThis.fetch = original; } };
}

function stubFetchThrow(error: Error): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> => Promise.reject(error);
  return { restore: () => { globalThis.fetch = original; } };
}

// ---------------------------------------------------------------------------
// detectMediaType
// ---------------------------------------------------------------------------

Deno.test("detectMediaType - classifies image extensions", () => {
  assertEquals(detectMediaType("https://example.com/photo.jpg"), "image");
  assertEquals(detectMediaType("https://example.com/photo.jpeg"), "image");
  assertEquals(detectMediaType("https://example.com/photo.png"), "image");
  assertEquals(detectMediaType("https://example.com/photo.gif"), "image");
  assertEquals(detectMediaType("https://example.com/photo.webp"), "image");
  assertEquals(detectMediaType("https://example.com/photo.svg"), "image");
  assertEquals(detectMediaType("https://example.com/photo.bmp"), "image");
});

Deno.test("detectMediaType - classifies audio extensions", () => {
  assertEquals(detectMediaType("https://example.com/audio.ogg"), "audio");
  assertEquals(detectMediaType("https://example.com/audio.oga"), "audio");
  assertEquals(detectMediaType("https://example.com/audio.mp3"), "audio");
  assertEquals(detectMediaType("https://example.com/audio.wav"), "audio");
  assertEquals(detectMediaType("https://example.com/audio.m4a"), "audio");
  assertEquals(detectMediaType("https://example.com/audio.aac"), "audio");
  assertEquals(detectMediaType("https://example.com/audio.flac"), "audio");
  assertEquals(detectMediaType("https://example.com/audio.opus"), "audio");
});

Deno.test("detectMediaType - returns file for unknown extensions", () => {
  assertEquals(detectMediaType("https://example.com/report.pdf"), "file");
  assertEquals(detectMediaType("https://example.com/data.csv"), "file");
  assertEquals(detectMediaType("https://example.com/archive.zip"), "file");
  assertEquals(detectMediaType("https://example.com/noextension"), "file");
});

Deno.test("detectMediaType - handles data URIs", () => {
  assertEquals(detectMediaType("data:image/jpeg;base64,/9j/abc"), "image");
  assertEquals(detectMediaType("data:image/png;base64,iVBOR"), "image");
  assertEquals(detectMediaType("data:audio/ogg;base64,T2dn"), "audio");
  assertEquals(detectMediaType("data:audio/mpeg;base64,//s="), "audio");
  assertEquals(detectMediaType("data:application/pdf;base64,JVB"), "file");
});

Deno.test("detectMediaType - ignores query string when detecting extension", () => {
  assertEquals(detectMediaType("https://example.com/photo.jpg?size=large"), "image");
  assertEquals(detectMediaType("https://example.com/audio.mp3?token=abc"), "audio");
  assertEquals(detectMediaType("https://example.com/file.pdf?download=1"), "file");
});

// ---------------------------------------------------------------------------
// detectAudioFormat
// ---------------------------------------------------------------------------

Deno.test("detectAudioFormat - returns correct format for known extensions", () => {
  assertEquals(detectAudioFormat("https://example.com/audio.wav"), "wav");
  assertEquals(detectAudioFormat("https://example.com/audio.mp3"), "mp3");
  assertEquals(detectAudioFormat("https://example.com/audio.aiff"), "aiff");
  assertEquals(detectAudioFormat("https://example.com/audio.aac"), "aac");
  assertEquals(detectAudioFormat("https://example.com/audio.ogg"), "ogg");
  assertEquals(detectAudioFormat("https://example.com/audio.oga"), "ogg");
  assertEquals(detectAudioFormat("https://example.com/audio.flac"), "flac");
  assertEquals(detectAudioFormat("https://example.com/audio.m4a"), "m4a");
});

Deno.test("detectAudioFormat - defaults to ogg for unknown extensions", () => {
  assertEquals(detectAudioFormat("https://example.com/audio.xyz"), "ogg");
  assertEquals(detectAudioFormat("https://example.com/noextension"), "ogg");
});

Deno.test("detectAudioFormat - strips query string from extension", () => {
  assertEquals(detectAudioFormat("https://example.com/audio.mp3?token=abc"), "mp3");
});

Deno.test("detectAudioFormat - data URI audio/ogg returns ogg", () => {
  assertEquals(detectAudioFormat("data:audio/ogg;base64,T2dnUw=="), "ogg");
});

Deno.test("detectAudioFormat - data URI audio/wav returns wav", () => {
  assertEquals(detectAudioFormat("data:audio/wav;base64,UklGR..."), "wav");
});

Deno.test("detectAudioFormat - unknown data URI MIME returns ogg default", () => {
  assertEquals(detectAudioFormat("data:audio/x-custom;base64,..."), "ogg");
});

Deno.test("detectMediaType - data URI video returns file", () => {
  assertEquals(detectMediaType("data:video/mp4;base64,AAAA"), "file");
});

// ---------------------------------------------------------------------------
// downloadAsBase64
// ---------------------------------------------------------------------------

Deno.test("downloadAsBase64 - returns base64 data and mimeType on success", async () => {
  const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // OGG magic bytes
  const stub = stubFetch(bytes, 200, { "Content-Type": "audio/ogg" });

  try {
    const result = await downloadAsBase64("https://example.com/audio.ogg");
    assertEquals(typeof result.data, "string");
    assertEquals(result.data.length > 0, true);
    assertEquals(result.mimeType, "audio/ogg");
  } finally {
    stub.restore();
  }
});

Deno.test("downloadAsBase64 - throws on HTTP error", async () => {
  const stub = stubFetch("Not Found", 404);

  try {
    await assertRejects(
      () => downloadAsBase64("https://example.com/audio.ogg"),
      Error,
      "Download failed: HTTP 404",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("downloadAsBase64 - throws when content-length exceeds limit", async () => {
  const stub = stubFetch("data", 200, {
    "Content-Length": String(30 * 1024 * 1024), // 30MB > 25MB limit
  });

  try {
    await assertRejects(
      () => downloadAsBase64("https://example.com/large.bin"),
      Error,
      "File too large",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("downloadAsBase64 - throws on network error", async () => {
  const stub = stubFetchThrow(new TypeError("Failed to fetch"));

  try {
    await assertRejects(
      () => downloadAsBase64("https://example.com/audio.ogg"),
      TypeError,
      "Failed to fetch",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("downloadAsBase64 - uses application/octet-stream when no content-type header", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> => {
    return Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
  };

  try {
    const result = await downloadAsBase64("https://example.com/file");
    assertEquals(result.mimeType, "application/octet-stream");
  } finally {
    globalThis.fetch = original;
  }
});

// ---------------------------------------------------------------------------
// buildContentParts
// ---------------------------------------------------------------------------

Deno.test("buildContentParts - text only (empty media) returns single text part", async () => {
  const parts = await buildContentParts("hello", []);
  assertEquals(parts.length, 1);
  assertEquals(parts[0], { type: "text", text: "hello" });
});

Deno.test("buildContentParts - image data URI produces image_url part", async () => {
  const dataUri = "data:image/jpeg;base64,/9j/abc123";
  const parts = await buildContentParts("look at this", [dataUri]);

  assertEquals(parts.length, 2);
  assertEquals(parts[0], { type: "text", text: "look at this" });
  assertEquals(parts[1], {
    type: "image_url",
    image_url: { url: dataUri },
  });
});

Deno.test("buildContentParts - image HTTP URL produces image_url part (no download)", async () => {
  // No fetch stub needed — images are passed through directly
  const url = "https://example.com/photo.png";
  const parts = await buildContentParts("check this image", [url]);

  assertEquals(parts.length, 2);
  assertEquals(parts[0], { type: "text", text: "check this image" });
  assertEquals(parts[1], {
    type: "image_url",
    image_url: { url },
  });
});

Deno.test("buildContentParts - audio data URI produces input_audio part", async () => {
  const dataUri = "data:audio/ogg;base64,T2dnUwAC";
  const parts = await buildContentParts("listen", [dataUri]);

  assertEquals(parts.length, 2);
  assertEquals(parts[0], { type: "text", text: "listen" });
  assertEquals(parts[1], {
    type: "input_audio",
    input_audio: { data: "T2dnUwAC", format: "ogg" },
  });
});

Deno.test("buildContentParts - audio HTTP URL downloads and produces input_audio part", async () => {
  const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
  const stub = stubFetch(bytes, 200, { "Content-Type": "audio/ogg" });

  try {
    const parts = await buildContentParts("audio message", ["https://example.com/voice.ogg"]);

    assertEquals(parts.length, 2);
    assertEquals(parts[0], { type: "text", text: "audio message" });
    assertEquals(parts[1].type, "input_audio");
    if (parts[1].type === "input_audio") {
      assertEquals(parts[1].input_audio.format, "ogg");
      assertEquals(typeof parts[1].input_audio.data, "string");
      assertEquals(parts[1].input_audio.data.length > 0, true);
    }
  } finally {
    stub.restore();
  }
});

Deno.test("buildContentParts - unknown file type produces text annotation", async () => {
  const parts = await buildContentParts("here is a file", ["https://example.com/report.pdf"]);

  assertEquals(parts.length, 2);
  assertEquals(parts[0], { type: "text", text: "here is a file" });
  assertEquals(parts[1], {
    type: "text",
    text: "[Attached file: https://example.com/report.pdf]",
  });
});

Deno.test("buildContentParts - failed audio download produces error annotation", async () => {
  const stub = stubFetch("Not Found", 404);

  try {
    const parts = await buildContentParts("voice", ["https://example.com/audio.mp3"]);

    assertEquals(parts.length, 2);
    assertEquals(parts[0], { type: "text", text: "voice" });
    assertEquals(parts[1].type, "text");
    if (parts[1].type === "text") {
      assertEquals(
        parts[1].text.startsWith("[Attached file (download failed):"),
        true,
      );
    }
  } finally {
    stub.restore();
  }
});

Deno.test("buildContentParts - mixed image and audio", async () => {
  const imageUrl = "https://example.com/photo.jpg";
  const audioDataUri = "data:audio/mpeg;base64,//uQxAA=";

  const parts = await buildContentParts("both", [imageUrl, audioDataUri]);

  assertEquals(parts.length, 3);
  assertEquals(parts[0], { type: "text", text: "both" });
  assertEquals(parts[1], { type: "image_url", image_url: { url: imageUrl } });
  assertEquals(parts[2].type, "input_audio");
  if (parts[2].type === "input_audio") {
    assertEquals(parts[2].input_audio.format, "mp3");
  }
});
