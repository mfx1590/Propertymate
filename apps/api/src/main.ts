import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { throttleBypassActive } from './common/guards/app-throttler.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // structured logging (pino) as the app logger
  const logger = app.get(Logger);
  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // consistent error shape + logging; no stack/DB detail leaks to clients
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost), logger));

  // The dev default covers both front ends: Next on :3000 and Expo's web
  // preview on :8081. Native builds of the mobile app send no Origin at all,
  // so CORS never applies to a real device — only to the browser preview.
  // Production always sets CORS_ORIGIN explicitly (see docs/deployment.md).
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? [
      'http://localhost:3000',
      'http://localhost:8081',
    ],
    credentials: true,
  });

  // Said once, loudly, at boot: a process with the §2.4 limits off must never
  // be mistaken for a normal one when someone reads the log later.
  if (throttleBypassActive()) {
    logger.warn('AUTH_THROTTLE_BYPASS is set — rate limiting is OFF for this non-production process');
  }

  // flush pino + close DB/connections cleanly on SIGTERM/SIGINT
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
}

bootstrap();
