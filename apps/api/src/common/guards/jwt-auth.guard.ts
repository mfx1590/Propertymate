import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const token = this.extractBearerToken(request);

    if (isPublic) {
      // A public route stays public, but a valid token is still worth reading:
      // it lets the listing page attribute a view to the signed-in viewer and
      // skip the lister's own visits (§6.7, §8). An absent or bad token is
      // simply an anonymous visitor here — never an error.
      if (token) {
        try {
          request.user = await this.jwtService.verifyAsync(token, {
            secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          });
        } catch {
          /* anonymous */
        }
      }
      return true;
    }

    if (!token) throw new UnauthorizedException('Missing access token');

    try {
      request.user = await this.jwtService.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    return true;
  }

  private extractBearerToken(request: { headers: Record<string, string | undefined> }): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
