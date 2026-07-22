import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

/**
 * Catches every unhandled exception, logs it with the request id, and returns
 * a consistent JSON error shape. Internal errors never leak a stack trace or
 * DB detail to the client (Plan §11).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: Logger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: unknown = 'Internal server error';
    if (isHttp) {
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as { message?: unknown }).message ?? res;
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, reqId: req?.id, path: httpAdapter.getRequestUrl(req) },
        'Unhandled exception',
      );
    }

    httpAdapter.reply(
      ctx.getResponse(),
      {
        statusCode: status,
        error: isHttp ? exception.name.replace(/Exception$/, '') : 'InternalServerError',
        message,
        requestId: req?.id,
        timestamp: new Date().toISOString(),
      },
      status,
    );
  }
}
