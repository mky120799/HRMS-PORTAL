import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

/**
 * Private object storage. Files are never served from a public URL: callers
 * stream them through an authorised API endpoint. Keys are always prefixed
 * with the tenant id (tenants/<tenantId>/...), so a bug in one query cannot
 * point at another tenant's object namespace.
 *
 * Drivers: `s3` (production — bucket is private, SSE enabled in Terraform) and
 * `local` (development only; env validation forbids it in production).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: 's3' | 'local';
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly localDir: string;

  constructor(config: ConfigService) {
    this.driver = config.get('STORAGE_DRIVER', 'local');
    this.localDir = path.resolve(config.get('LOCAL_STORAGE_DIR', './storage'));
    if (this.driver === 's3') {
      this.s3 = new S3Client({ region: config.get('AWS_REGION') });
      this.bucket = config.getOrThrow('AWS_S3_BUCKET_NAME');
    }
  }

  static tenantKey(tenantId: string, ...parts: string[]): string {
    const safe = parts.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, '_'));
    return ['tenants', tenantId, ...safe].join('/');
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }),
      );
      return;
    }
    const file = this.localPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }

  async getStream(key: string): Promise<Readable> {
    if (this.s3) {
      try {
        const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        return res.Body as Readable;
      } catch (err: any) {
        if (err?.name === 'NoSuchKey') throw new NotFoundException('File not found');
        throw err;
      }
    }
    const file = this.localPath(key);
    await fs.access(file).catch(() => {
      throw new NotFoundException('File not found');
    });
    return createReadStream(file);
  }

  async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.s3) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      else await fs.rm(this.localPath(key), { force: true });
    } catch (err: any) {
      // Orphaned objects are preferable to failing the user's delete; log for cleanup.
      this.logger.error(`Failed to delete object ${key}: ${err.message}`);
    }
  }

  private localPath(key: string): string {
    const resolved = path.resolve(this.localDir, key);
    if (!resolved.startsWith(this.localDir + path.sep)) throw new Error('Invalid storage key');
    return resolved;
  }
}
