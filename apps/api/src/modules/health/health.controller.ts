import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Liveness — process is up and can reach the primary DB. */
  @Public()
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'up', timestamp: new Date().toISOString() };
  }

  /** Readiness — every dependency needed to serve traffic (Plan §11). */
  @Public()
  @Get('ready')
  async ready() {
    const checks = await Promise.all([
      this.timed('db', () => this.prisma.$queryRaw`SELECT 1`),
      this.timed('meilisearch', () => this.pingMeili()),
      this.timed('storage', () => this.pingStorage()),
    ]);
    const deps = Object.fromEntries(checks.map((c) => [c.name, c.ok ? 'up' : `down: ${c.error}`]));
    const allUp = checks.every((c) => c.ok);
    const body = { status: allUp ? 'ready' : 'degraded', deps, timestamp: new Date().toISOString() };
    if (!allUp) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }

  private async timed(name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      return { name, ok: true, error: null as string | null };
    } catch (e) {
      return { name, ok: false, error: (e as Error).message.slice(0, 120) };
    }
  }

  private async pingMeili() {
    const host = this.config.get<string>('MEILI_HOST') ?? 'http://localhost:7700';
    const res = await fetch(`${host}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`meili ${res.status}`);
  }

  private async pingStorage() {
    const client = new S3Client({
      endpoint: this.config.getOrThrow<string>('S3_ENDPOINT'),
      region: this.config.get<string>('S3_REGION') ?? 'auto',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      },
      forcePathStyle: true,
    });
    await client.send(new HeadBucketCommand({ Bucket: this.config.get<string>('S3_BUCKET_MEDIA') ?? 'media' }));
  }
}
