import { extname } from "@std/path";
import type { Tool } from "./base.ts";
import type { Storage } from "../../storage/base.ts";
import { assertWithinWorkspace } from "./filesystem.ts";

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".html": "text/html",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

export class UploadFileTool implements Tool {
  name = "upload_file";
  description =
    "Upload a file from the workspace to cloud storage. Returns a public URL that can be shared with users via the message tool.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Path to the file (relative to workspace or absolute within workspace).",
      },
      content_type: {
        type: "string",
        description:
          "MIME type of the file. Auto-detected from extension if not provided.",
      },
    },
    required: ["path"],
  };

  private workspace: string;
  private storage: Storage;

  constructor(workspace: string, storage: Storage) {
    this.workspace = workspace;
    this.storage = storage;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = String(args.path ?? "");
    if (!filePath) return "Error: path is required.";

    try {
      const safePath = assertWithinWorkspace(this.workspace, filePath);
      const data = await Deno.readFile(safePath);
      const ext = extname(safePath).toLowerCase();
      const contentType = args.content_type
        ? String(args.content_type)
        : (MIME_TYPES[ext] ?? "application/octet-stream");
      const key = this.storage.generateKey("files", ext.slice(1) || "bin");
      const url = await this.storage.upload(key, data, contentType);
      return `File uploaded: ${url}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error uploading file: ${msg}`;
    }
  }
}
