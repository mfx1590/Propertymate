import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Whether rate limiting is switched off for this process.
 *
 * Two conditions, both required: the operator asked for it by name, AND the
 * process is not a production build. The second is not configurable — the
 * production Dockerfile bakes `NODE_ENV=production`, so no `.env` mistake on
 * the VPS can disable the §2.4 limits. What this exists for is CI and local
 * e2e runs, where 22 suites each spending a few OTP sends against a 5-per-
 * minute limit meant 21 minutes of `sleep 60` in a 25-minute pipeline.
 */
export function throttleBypassActive(): boolean {
  const asked = /^(1|true|yes)$/i.test(process.env.AUTH_THROTTLE_BYPASS ?? '');
  return asked && process.env.NODE_ENV !== 'production';
}

/**
 * The platform's throttler, with one non-production escape hatch. Everything
 * else — the per-route `@Throttle` tiers, `@SkipThrottle` on public browse
 * endpoints, the Redis-agnostic in-memory store — is inherited unchanged.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (throttleBypassActive()) return true;
    return super.shouldSkip(context);
  }
}
