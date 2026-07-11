import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import sharp, { type Sharp } from 'sharp';
import { StorageService } from '../../common/storage/storage.service';

export interface ProcessedPhoto {
  url: string;
  thumbUrl: string;
  phash: string;
  width: number;
  height: number;
}

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * Photo pipeline (Plan §2.4): every listing photo gets EXIF stripped
 * (GPS/device metadata never reaches the CDN), is re-encoded, thumbnailed,
 * and perceptually hashed for cross-listing duplicate detection.
 */
@Injectable()
export class MediaService {
  constructor(private readonly storage: StorageService) {}

  async processListingPhoto(file: { buffer: Buffer; mimetype: string; size: number }): Promise<ProcessedPhoto> {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported image type ${file.mimetype}`);
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException('Image exceeds 15MB limit');
    }

    let base: Sharp;
    try {
      // .rotate() applies EXIF orientation; re-encoding without withMetadata() strips all EXIF
      base = sharp(file.buffer).rotate();
      await base.metadata();
    } catch {
      throw new BadRequestException('File is not a readable image');
    }

    const main = await base
      .clone()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    const thumb = await base
      .clone()
      .resize({ width: 480, height: 360, fit: 'cover' })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();

    const phash = await this.averageHash(base);

    const id = randomUUID();
    const url = await this.storage.putPublicMedia(`properties/${id}.jpg`, main.data, 'image/jpeg');
    const thumbUrl = await this.storage.putPublicMedia(`properties/${id}_t.jpg`, thumb, 'image/jpeg');

    return { url, thumbUrl, phash, width: main.info.width, height: main.info.height };
  }

  /**
   * 64-bit average hash (8x8 grayscale, bit = pixel >= mean), hex-encoded.
   * Near-duplicates differ by a small Hamming distance.
   */
  private async averageHash(image: Sharp): Promise<string> {
    const { data } = await image
      .clone()
      .grayscale()
      .resize(8, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const mean = data.reduce((sum: number, v: number) => sum + v, 0) / data.length;
    let hash = 0n;
    for (let i = 0; i < 64; i++) {
      hash = (hash << 1n) | (data[i] >= mean ? 1n : 0n);
    }
    return hash.toString(16).padStart(16, '0');
  }

  /** Hamming distance between two hex-encoded 64-bit hashes. */
  static hammingDistance(a: string, b: string): number {
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let count = 0;
    while (x > 0n) {
      count += Number(x & 1n);
      x >>= 1n;
    }
    return count;
  }
}
