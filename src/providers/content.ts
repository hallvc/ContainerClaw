/**
 * OpenAI-compatible content part types used across the provider and context layers.
 */

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageUrlContentPart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export interface InputAudioContentPart {
  type: "input_audio";
  input_audio: { data: string; format: string };
}

export type ContentPart = TextContentPart | ImageUrlContentPart | InputAudioContentPart;
export type MessageContent = string | ContentPart[] | null;
