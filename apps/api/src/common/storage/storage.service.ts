import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible storage (MinIO locally, Cloudflare R2 in prod — Plan §2.1).
 * media bucket = public CDN; documents bucket = PRIVATE, signed URLs only (Plan §2.4).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  readonly mediaBucket: string;
  readonly documentsBucket: string;
  private readonly publicBase: string;

  constructor(config: ConfigService) {
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      region: config.get<string>('S3_REGION') ?? 'auto',
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
      forcePathStyle: true, // required for MinIO
    });
    this.mediaBucket = config.get<string>('S3_BUCKET_MEDIA') ?? 'media';
    this.documentsBucket = config.get<string>('S3_BUCKET_DOCUMENTS') ?? 'documents';
    this.publicBase =
      config.get<string>('S3_PUBLIC_URL') ??
      `${config.getOrThrow<string>('S3_ENDPOINT')}/${this.mediaBucket}`;
  }

  async putPublicMedia(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.mediaBucket, Key: key, Body: body, ContentType: contentType }),
    );
    return `${this.publicBase}/${key}`;
  }

  async putPrivateDocument(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.documentsBucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Short-lived signed URL — the ONLY way documents are ever served (Plan §2.4). */
  async signedDocumentUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.documentsBucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
