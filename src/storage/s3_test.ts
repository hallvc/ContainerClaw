import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { StorageClient } from "./s3.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(overrides: Partial<{
  publicUrlIncludesBucket: boolean;
  publicUrl: string;
  bucket: string;
}> = {}): StorageClient {
  return new StorageClient({
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    bucket: overrides.bucket ?? "test-bucket",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    publicUrl: overrides.publicUrl ?? "http://localhost:9000",
    forcePathStyle: true,
    publicUrlIncludesBucket: overrides.publicUrlIncludesBucket ?? true,
  });
}

// Patch the internal S3Client.send on a StorageClient instance.
// deno-lint-ignore no-explicit-any
function patchSend(client: StorageClient, impl: (command: any) => Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  (client as any).client = { send: impl };
}

// ---------------------------------------------------------------------------
// 1. generateKey
// ---------------------------------------------------------------------------

Deno.test("generateKey - produces correct format", () => {
  const client = makeClient();
  const key = client.generateKey("images", "png");
  // Should match: images/YYYY-MM-DD/uuid.png
  assertMatch(key, /^images\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.png$/);
});

Deno.test("generateKey - produces unique keys", () => {
  const client = makeClient();
  const a = client.generateKey("audio", "ogg");
  const b = client.generateKey("audio", "ogg");
  assertEquals(a !== b, true);
});

// ---------------------------------------------------------------------------
// 2. getUrl
// ---------------------------------------------------------------------------

Deno.test("getUrl - includes bucket when publicUrlIncludesBucket is true", () => {
  const client = makeClient({
    publicUrl: "http://localhost:9000",
    bucket: "mybucket",
    publicUrlIncludesBucket: true,
  });
  assertEquals(client.getUrl("images/2026-02-25/test.png"), "http://localhost:9000/mybucket/images/2026-02-25/test.png");
});

Deno.test("getUrl - excludes bucket when publicUrlIncludesBucket is false", () => {
  const client = makeClient({
    publicUrl: "https://cdn.example.com",
    bucket: "mybucket",
    publicUrlIncludesBucket: false,
  });
  assertEquals(client.getUrl("images/2026-02-25/test.png"), "https://cdn.example.com/images/2026-02-25/test.png");
});

// ---------------------------------------------------------------------------
// 3. upload
// ---------------------------------------------------------------------------

Deno.test("upload - calls PutObjectCommand with correct params and returns URL", async () => {
  const client = makeClient({ bucket: "test-bucket" });
  const capturedParams: unknown[] = [];

  patchSend(client, (cmd) => {
    capturedParams.push(cmd);
    return Promise.resolve({});
  });

  const data = new Uint8Array([1, 2, 3]);
  const url = await client.upload("test/key.png", data, "image/png");

  assertEquals(url, "http://localhost:9000/test-bucket/test/key.png");
  assertEquals(capturedParams.length, 1);
  // deno-lint-ignore no-explicit-any
  const cmd = capturedParams[0] as any;
  assertEquals(cmd.input.Bucket, "test-bucket");
  assertEquals(cmd.input.Key, "test/key.png");
  assertEquals(cmd.input.ContentType, "image/png");
  assertEquals(cmd.input.Body, data);
});

// ---------------------------------------------------------------------------
// 4. uploadFromDataUri
// ---------------------------------------------------------------------------

Deno.test("uploadFromDataUri - parses data URI and uploads with correct content type", async () => {
  const client = makeClient();
  const capturedParams: unknown[] = [];

  patchSend(client, (cmd) => {
    capturedParams.push(cmd);
    return Promise.resolve({});
  });

  // Small base64-encoded PNG-like bytes
  const originalBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const base64 = btoa(String.fromCharCode(...originalBytes));
  const dataUri = `data:image/png;base64,${base64}`;

  const url = await client.uploadFromDataUri("images/test.png", dataUri);

  assertEquals(url, "http://localhost:9000/test-bucket/images/test.png");
  assertEquals(capturedParams.length, 1);
  // deno-lint-ignore no-explicit-any
  const cmd = capturedParams[0] as any;
  assertEquals(cmd.input.ContentType, "image/png");
  assertEquals(cmd.input.Key, "images/test.png");
});

Deno.test("uploadFromDataUri - throws on invalid data URI", async () => {
  const client = makeClient();
  patchSend(client, () => Promise.resolve({}));

  await assertRejects(
    () => client.uploadFromDataUri("key", "not-a-data-uri"),
    Error,
    "Invalid data URI",
  );
});

Deno.test("uploadFromDataUri - uses octet-stream for missing MIME type", async () => {
  const client = makeClient();
  const capturedParams: unknown[] = [];
  patchSend(client, (cmd) => {
    capturedParams.push(cmd);
    return Promise.resolve({});
  });

  // data URI with no MIME type prefix (malformed but comma present)
  await client.uploadFromDataUri("key", ",dGVzdA==");

  // deno-lint-ignore no-explicit-any
  const cmd = capturedParams[0] as any;
  assertEquals(cmd.input.ContentType, "application/octet-stream");
});

// ---------------------------------------------------------------------------
// 5. ensureBucket
// ---------------------------------------------------------------------------

Deno.test("ensureBucket - ignores BucketAlreadyOwnedByYou error", async () => {
  const client = makeClient();
  patchSend(client, () => {
    const err = new Error("bucket already owned") as Error & { name: string };
    err.name = "BucketAlreadyOwnedByYou";
    return Promise.reject(err);
  });

  // Should not throw
  await client.ensureBucket();
});

Deno.test("ensureBucket - ignores BucketAlreadyExists error", async () => {
  const client = makeClient();
  patchSend(client, () => {
    const err = new Error("bucket already exists") as Error & { name: string };
    err.name = "BucketAlreadyExists";
    return Promise.reject(err);
  });

  await client.ensureBucket();
});

Deno.test("ensureBucket - rethrows unknown errors", async () => {
  const client = makeClient();
  patchSend(client, () => {
    return Promise.reject(new Error("permission denied"));
  });

  await assertRejects(
    () => client.ensureBucket(),
    Error,
    "permission denied",
  );
});

Deno.test("ensureBucket - succeeds when bucket is created", async () => {
  const client = makeClient();
  let called = false;
  patchSend(client, () => {
    called = true;
    return Promise.resolve({});
  });

  await client.ensureBucket();
  assertEquals(called, true);
});

// ---------------------------------------------------------------------------
// 6. exists
// ---------------------------------------------------------------------------

Deno.test("exists - returns true when HeadObjectCommand succeeds", async () => {
  const client = makeClient();
  patchSend(client, () => Promise.resolve({}));

  const result = await client.exists("some/key.png");
  assertEquals(result, true);
});

Deno.test("exists - returns false on NotFound error", async () => {
  const client = makeClient();
  patchSend(client, () => {
    const err = new Error("not found") as Error & { name: string };
    err.name = "NotFound";
    return Promise.reject(err);
  });

  const result = await client.exists("some/key.png");
  assertEquals(result, false);
});

Deno.test("exists - returns false on NoSuchKey error", async () => {
  const client = makeClient();
  patchSend(client, () => {
    const err = new Error("no such key") as Error & { name: string };
    err.name = "NoSuchKey";
    return Promise.reject(err);
  });

  const result = await client.exists("some/key.png");
  assertEquals(result, false);
});

Deno.test("exists - rethrows unexpected errors", async () => {
  const client = makeClient();
  patchSend(client, () => {
    return Promise.reject(new Error("network failure"));
  });

  await assertRejects(
    () => client.exists("some/key.png"),
    Error,
    "network failure",
  );
});

// ---------------------------------------------------------------------------
// 7. delete
// ---------------------------------------------------------------------------

Deno.test("delete - calls DeleteObjectCommand with correct key", async () => {
  const client = makeClient({ bucket: "test-bucket" });
  const capturedParams: unknown[] = [];
  patchSend(client, (cmd) => {
    capturedParams.push(cmd);
    return Promise.resolve({});
  });

  await client.delete("images/old.png");

  assertEquals(capturedParams.length, 1);
  // deno-lint-ignore no-explicit-any
  const cmd = capturedParams[0] as any;
  assertEquals(cmd.input.Bucket, "test-bucket");
  assertEquals(cmd.input.Key, "images/old.png");
});

// ---------------------------------------------------------------------------
// 8. uploadFromUrl
// ---------------------------------------------------------------------------

Deno.test("uploadFromUrl - fetches URL, uploads bytes, returns S3 URL", async () => {
  const client = makeClient({ bucket: "test-bucket" });
  const capturedParams: unknown[] = [];
  patchSend(client, (cmd) => {
    capturedParams.push(cmd);
    return Promise.resolve({});
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input: string | URL | Request): Promise<Response> => {
    return Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]).buffer, {
        status: 200,
        headers: { "content-type": "image/jpeg; charset=binary" },
      }),
    );
  };

  try {
    const url = await client.uploadFromUrl("photos/new.jpg", "https://example.com/photo.jpg");
    assertEquals(url, "http://localhost:9000/test-bucket/photos/new.jpg");
    // deno-lint-ignore no-explicit-any
    const cmd = capturedParams[0] as any;
    assertEquals(cmd.input.ContentType, "image/jpeg");
    assertEquals(cmd.input.Key, "photos/new.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("uploadFromUrl - throws when fetch returns non-ok status", async () => {
  const client = makeClient();
  patchSend(client, () => Promise.resolve({}));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> => {
    return Promise.resolve(new Response(null, { status: 404, statusText: "Not Found" }));
  };

  try {
    await assertRejects(
      () => client.uploadFromUrl("key", "https://example.com/missing.jpg"),
      Error,
      "404",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
