import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  /** user id */
  sub: string;
  phone?: string;
  email?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
