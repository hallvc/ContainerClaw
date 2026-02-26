import type { Tool } from "./base.ts";
import type { Storage } from "../../storage/base.ts";

export class ImageGenTool implements Tool {
  name = "generate_image";
  description =
    "Generate an image from a text prompt. Uploads to storage and returns the URL.";
  parameters = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Text description of the image to generate.",
      },
      size: {
        type: "string",
        enum: ["1024x1024", "512x512", "1792x1024"],
        description: "Image size. Defaults to 1024x1024.",
      },
    },
    required: ["prompt"],
  };

  private apiKey: string;
  private model: string;
  private storage: Storage;

  constructor(apiKey: string, model: string, storage: Storage) {
    this.apiKey = apiKey;
    this.model = model;
    this.storage = storage;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const prompt = String(args.prompt ?? "");
    const size = String(args.size ?? "1024x1024");

    if (!prompt) return "Error: prompt is required.";

    try {
      const response = await fetch(
        "https://openrouter.ai/api/v1/images/generations",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/containerclaw/containerclaw",
            "X-Title": "containerclaw",
          },
          body: JSON.stringify({
            model: this.model,
            prompt,
            n: 1,
            size,
            response_format: "b64_json",
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return `Error generating image: HTTP ${response.status} - ${
          errorText.slice(0, 200)
        }`;
      }

      const data = await response.json();
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) {
        // Check for URL format response
        const url = data.data?.[0]?.url;
        if (url) {
          const key = this.storage.generateKey("images", "png");
          const s3Url = await this.storage.uploadFromUrl(key, url);
          return `Image generated and uploaded: ${s3Url}`;
        }
        return "Error: No image data in response.";
      }

      // Decode base64 and upload to storage
      const { decodeBase64 } = await import("@std/encoding/base64");
      const imageBytes = decodeBase64(b64);
      const key = this.storage.generateKey("images", "png");
      const s3Url = await this.storage.upload(key, imageBytes, "image/png");
      return `Image generated and uploaded: ${s3Url}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error generating image: ${msg}`;
    }
  }
}
