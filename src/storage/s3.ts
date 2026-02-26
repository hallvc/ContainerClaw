import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { decodeBase64 } from "@std/encoding/base64";
import type { Storage } from "./base.ts";

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  forcePathStyle: boolean;
  publicUrlIncludesBucket: boolean;
}

export class StorageClient implements Storage {
  private client: S3Client;
  private config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(
        new CreateBucketCommand({ Bucket: this.config.bucket }),
      );
    } catch (err) {
      const code = (err as { name?: string; Code?: string }).name ??
        (err as { Code?: string }).Code;
      if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") {
        return;
      }
      throw err;
    }
  }

  async upload(key: string, data: Uint8Array, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
    return this.getUrl(key);
  }

  async uploadFromDataUri(key: string, dataUri: string): Promise<string> {
    // data:mime/type;base64,<data>
    const commaIdx = dataUri.indexOf(",");
    if (commaIdx === -1) {
      throw new Error("Invalid data URI: missing comma separator");
    }
    const header = dataUri.slice(0, commaIdx); // e.g. "data:image/jpeg;base64"
    const base64Data = dataUri.slice(commaIdx + 1);

    // Extract MIME type from header
    const mimeMatch = header.match(/^data:([^;]+)/);
    const contentType = mimeMatch ? mimeMatch[1] : "application/octet-stream";

    const data = decodeBase64(base64Data);
    return this.upload(key, data, contentType);
  }

  async uploadFromUrl(key: string, sourceUrl: string): Promise<string> {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    return this.upload(key, data, contentType.split(";")[0].trim());
  }

  getUrl(key: string): string {
    if (this.config.publicUrlIncludesBucket) {
      return `${this.config.publicUrl}/${this.config.bucket}/${key}`;
    }
    return `${this.config.publicUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") {
        return false;
      }
      throw err;
    }
  }

  generateKey(prefix: string, ext: string): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const uuid = crypto.randomUUID();
    return `${prefix}/${date}/${uuid}.${ext}`;
  }
}
