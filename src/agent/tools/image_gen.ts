import type { Tool } from "./base.ts";
import type { Storage } from "../../storage/base.ts";
import type { OpenRouterClient } from "../../providers/openrouter_client.ts";

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
      aspect_ratio: {
        type: "string",
        enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"],
        description: "Image aspect ratio. Defaults to 1:1.",
      },
    },
    required: ["prompt"],
  };

  private client: OpenRouterClient;
  private model: string;
  private storage: Storage;

  constructor(client: OpenRouterClient, model: string, storage: Storage) {
    this.client = client;
    this.model = model;
    this.storage = storage;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const prompt = String(args.prompt ?? "");
    const aspectRatio = String(args.aspect_ratio ?? "1:1");

    if (!prompt) return "Error: prompt is required.";

    try {
      const response = await this.client.postJSON("/chat/completions", {
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image"],
        image_config: { aspect_ratio: aspectRatio },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return `Error generating image: HTTP ${response.status} - ${
          errorText.slice(0, 200)
        }`;
      }

      const data = await response.json();

      // OpenRouter returns images as data URIs in choices[].message.images[]
      const images = data.choices?.[0]?.message?.images;
      if (images && images.length > 0) {
        const dataUri: string = images[0]?.image_url?.url ?? images[0]?.url;
        if (dataUri) {
          const key = this.storage.generateKey("images", "png");
          const s3Url = await this.storage.uploadFromDataUri(key, dataUri);
          return `Image generated and uploaded: ${s3Url}`;
        }
      }

      // Fallback: some models may return inline base64 in content
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.startsWith("data:image")) {
        const key = this.storage.generateKey("images", "png");
        const s3Url = await this.storage.uploadFromDataUri(key, content);
        return `Image generated and uploaded: ${s3Url}`;
      }

      return "Error: No image data in response.";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error generating image: ${msg}`;
    }
  }
}
