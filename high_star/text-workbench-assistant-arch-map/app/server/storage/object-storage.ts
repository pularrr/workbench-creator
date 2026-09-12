import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<{ key: string; checksum: string; bytes: number }>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

/** Development fallback with the same contract; production should inject S3ObjectStorage. */
export class FileObjectStorage implements ObjectStorage {
  constructor(private readonly root = join(process.cwd(), "data", "runtime", "objects")) {}
  private path(key: string) { if (key.includes("..") || key.startsWith("/")) throw new Error("Invalid object key."); return join(this.root, key); }
  async put(key: string, body: Uint8Array, _contentType: string) { const path = this.path(key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, body); return { key, checksum: createHash("sha256").update(body).digest("hex"), bytes: body.byteLength }; }
  async get(key: string) { try { return new Uint8Array(await readFile(this.path(key))); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
  async delete(key: string) { try { await unlink(this.path(key)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}

/** S3-compatible storage adapter. Works with AWS S3, MinIO and Cloudflare R2. */
export class S3ObjectStorage implements ObjectStorage {
  constructor(private readonly client: { send(command: unknown): Promise<unknown> }, private readonly commands: { put: new (input: any) => unknown; get: new (input: any) => unknown; delete: new (input: any) => unknown }, private readonly bucket: string) {}
  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(new this.commands.put({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return { key, checksum: createHash("sha256").update(body).digest("hex"), bytes: body.byteLength };
  }
  async get(key: string) {
    const result = await this.client.send(new this.commands.get({ Bucket: this.bucket, Key: key })) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
    return result.Body?.transformToByteArray ? result.Body.transformToByteArray() : undefined;
  }
  async delete(key: string) { await this.client.send(new this.commands.delete({ Bucket: this.bucket, Key: key })); }
}

export function runtimeObjectStorage(): ObjectStorage {
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim();
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return new FileObjectStorage();
  const client = new S3Client({ region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1", endpoint: process.env.OBJECT_STORAGE_ENDPOINT, forcePathStyle: Boolean(process.env.OBJECT_STORAGE_ENDPOINT), credentials: { accessKeyId, secretAccessKey } });
  return new S3ObjectStorage({ send: (command) => client.send(command as never) }, { put: PutObjectCommand, get: GetObjectCommand, delete: DeleteObjectCommand }, bucket);
}
