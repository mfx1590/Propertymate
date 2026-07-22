import { randomUUID } from 'crypto';
import { LoggerModule } from 'nestjs-pino';

/**
 * Structured JSON logging (Plan §11). Each request gets an id (from the
 * inbound header or generated), auth tokens/passwords are redacted, and a
 * one-line access log is emitted per request. Pretty-printed in dev.
 */
export const PinoLoggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    autoLogging: true,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.code',
        'req.body.refreshToken',
      ],
      remove: true,
    },
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url };
      },
    },
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } },
  },
});
