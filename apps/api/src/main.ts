import "reflect-metadata";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { ValidationPipe } from "@nestjs/common";
import { loadEnv } from "@helpflow/config";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { RedisIoAdapter } from "./common/realtime/redis-io.adapter";

async function bootstrap() {
  const env = loadEnv(); // exits the process on invalid/missing config — must run before anything else

  // rawBody: true exposes req.rawBody so the Stripe webhook controller can verify the signature
  // against the exact wire bytes (the JSON body-parser's re-serialized body would never match).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  app.useWebSocketAdapter(new RedisIoAdapter(app));

  app.enableCors({
    origin: [env.APP_URL, env.WIDGET_ORIGIN],
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());

  await app.listen(env.PORT);
}

bootstrap();
