import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { UploadFileTool } from "./upload.ts";
import type { Storage } from "../../storage/base.ts";

function mockStorage(): Storage {
  return {
    upload: async (_key: string, _data: Uint8Array, _ct: string) =>
      "https://s3.example.com/files/test.pdf",
    uploadFromDataUri: async () => "",
    uploadFromUrl: async () => "",
    getUrl: () => "",
    delete: async () => {},
    exists: async () => false,
    generateKey: (_prefix: string, ext: string) => `files/test.${ext}`,
  };
}

const workspace = Deno.realPathSync(Deno.makeTempDirSync());

Deno.test("UploadFileTool - uploads file and returns URL", async () => {
  const filePath = join(workspace, "report.pdf");
  await Deno.writeFile(filePath, new Uint8Array([37, 80, 68, 70])); // %PDF magic bytes

  const tool = new UploadFileTool(workspace, mockStorage());
  const result = await tool.execute({ path: "report.pdf" });
  assertStringIncludes(result, "https://s3.example.com");
  assertStringIncludes(result, "File uploaded:");
});

Deno.test("UploadFileTool - returns error for file outside workspace", async () => {
  const tool = new UploadFileTool(workspace, mockStorage());
  const result = await tool.execute({ path: "/tmp/outside.txt" });
  assertStringIncludes(result, "Error uploading file:");
  assertStringIncludes(result, "outside the workspace");
});

Deno.test("UploadFileTool - returns error for missing path", async () => {
  const tool = new UploadFileTool(workspace, mockStorage());
  const result = await tool.execute({ path: "" });
  assertEquals(result, "Error: path is required.");
});

Deno.test("UploadFileTool - auto-detects MIME type from extension", async () => {
  let capturedContentType = "";
  const storage: Storage = {
    upload: async (_key: string, _data: Uint8Array, ct: string) => {
      capturedContentType = ct;
      return "https://s3.example.com/files/test.png";
    },
    uploadFromDataUri: async () => "",
    uploadFromUrl: async () => "",
    getUrl: () => "",
    delete: async () => {},
    exists: async () => false,
    generateKey: (_prefix: string, ext: string) => `files/test.${ext}`,
  };

  const filePath = join(workspace, "image.png");
  await Deno.writeFile(filePath, new Uint8Array([137, 80, 78, 71])); // PNG magic bytes

  const tool = new UploadFileTool(workspace, storage);
  await tool.execute({ path: "image.png" });
  assertEquals(capturedContentType, "image/png");
});

Deno.test("UploadFileTool - uses provided content_type over auto-detected", async () => {
  let capturedContentType = "";
  const storage: Storage = {
    upload: async (_key: string, _data: Uint8Array, ct: string) => {
      capturedContentType = ct;
      return "https://s3.example.com/files/test.png";
    },
    uploadFromDataUri: async () => "",
    uploadFromUrl: async () => "",
    getUrl: () => "",
    delete: async () => {},
    exists: async () => false,
    generateKey: (_prefix: string, ext: string) => `files/test.${ext}`,
  };

  const filePath = join(workspace, "data.png");
  await Deno.writeFile(filePath, new Uint8Array([1, 2, 3, 4]));

  const tool = new UploadFileTool(workspace, storage);
  await tool.execute({ path: "data.png", content_type: "image/webp" });
  assertEquals(capturedContentType, "image/webp");
});
