export interface Storage {
  upload(key: string, data: Uint8Array, contentType: string): Promise<string>;
  uploadFromDataUri(key: string, dataUri: string): Promise<string>;
  uploadFromUrl(key: string, sourceUrl: string): Promise<string>;
  getUrl(key: string): string;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  generateKey(prefix: string, ext: string): string;
}
