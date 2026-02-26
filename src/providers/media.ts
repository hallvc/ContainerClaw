/**
 * Utility functions for media detection, downloading, and content part construction.
 */

import { encodeBase64 } from "@std/encoding/base64";
import type { ContentPart } from "./content.ts";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"]);
const AUDIO_EXTENSIONS = new Set(["ogg", "oga", "mp3", "wav", "m4a", "aac", "flac", "opus"]);

/**
 * Detect whether a URL or data URI points to an image, audio, or other file.
 */
export function detectMediaType(url: string): "image" | "audio" | "file" {
  // Handle data URIs
  if (url.startsWith("data:")) {
    const mime = url.split(";")[0].slice(5); // "data:image/jpeg;base64,..." → "image/jpeg"
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    return "file";
  }
  // Handle URLs - extract extension
  const path = url.split("?")[0].split("#")[0];
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "file";
}

/**
 * Detect audio format from URL file extension.
 * Extracted from transcription.ts to avoid duplication.
 */
export function detectAudioFormat(url: string): string {
  // Handle data URIs by checking MIME type
  if (url.startsWith("data:")) {
    const mime = url.split(";")[0].slice(5); // "data:audio/mpeg;base64,..." → "audio/mpeg"
    const mimeFormats: Record<string, string> = {
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/ogg": "ogg",
      "audio/aac": "aac",
      "audio/flac": "flac",
      "audio/m4a": "m4a",
      "audio/mp4": "m4a",
      "audio/aiff": "aiff",
      "audio/opus": "opus",
    };
    return mimeFormats[mime] ?? "ogg";
  }
  const ext = url.split(".").pop()?.split("?")[0]?.toLowerCase();
  const formats: Record<string, string> = {
    wav: "wav",
    mp3: "mp3",
    aiff: "aiff",
    aac: "aac",
    ogg: "ogg",
    oga: "ogg",
    flac: "flac",
    m4a: "m4a",
  };
  return formats[ext ?? ""] ?? "ogg";
}

const MAX_DOWNLOAD_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Download a URL and return the content as a base64 string with MIME type.
 * Uses @std/encoding/base64 (safe for large files, unlike btoa spread).
 */
export async function downloadAsBase64(
  url: string,
  maxSizeBytes = MAX_DOWNLOAD_SIZE,
): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > maxSizeBytes) {
    throw new Error(`File too large: ${contentLength} bytes (max ${maxSizeBytes})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxSizeBytes) {
    throw new Error(`File too large: ${bytes.length} bytes (max ${maxSizeBytes})`);
  }
  const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
  return { data: encodeBase64(bytes), mimeType };
}

/**
 * Download a URL and return the raw bytes with MIME type.
 */
export async function downloadAsBytes(
  url: string,
  maxSizeBytes = MAX_DOWNLOAD_SIZE,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxSizeBytes) {
    throw new Error(`File too large: ${bytes.length} bytes (max ${maxSizeBytes})`);
  }
  const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
  return { bytes, mimeType };
}

/**
 * Build an array of ContentPart objects from message text and a list of media items.
 *
 * Media items can be data URIs, S3 URLs, or regular HTTP(S) URLs.
 * - data:image/* → image_url content part (passed through directly)
 * - data:audio/* → input_audio content part (base64 data extracted from URI)
 * - http(s) image URL → image_url content part (URL passed directly)
 * - http(s) audio URL → downloaded, base64-encoded, input_audio content part
 * - Unknown type → text annotation "[Attached file: url]"
 */
export async function buildContentParts(
  text: string,
  mediaItems: string[],
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [{ type: "text", text }];

  for (const item of mediaItems) {
    const mediaType = detectMediaType(item);
    try {
      if (mediaType === "image") {
        // Images: pass URL or data URI directly
        parts.push({
          type: "image_url",
          image_url: { url: item },
        });
      } else if (mediaType === "audio") {
        if (item.startsWith("data:")) {
          // Data URI audio: extract base64 data
          const base64Data = item.split(",")[1] ?? "";
          const format = detectAudioFormat(item);
          parts.push({
            type: "input_audio",
            input_audio: { data: base64Data, format },
          });
        } else {
          // URL audio: download and base64 encode
          const { data } = await downloadAsBase64(item);
          const format = detectAudioFormat(item);
          parts.push({
            type: "input_audio",
            input_audio: { data, format },
          });
        }
      } else {
        // Unknown file type: text annotation
        parts.push({ type: "text", text: `[Attached file: ${item}]` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to process media ${item}: ${msg}`);
      parts.push({ type: "text", text: `[Attached file (download failed): ${item}]` });
    }
  }

  return parts;
}
