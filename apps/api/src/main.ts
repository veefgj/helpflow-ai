import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { ValidationPipe } from "@nestjs/common";
import { loadEnv } from "@helpflow/config";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";

async function bootstrap() {
  const env = loadEnv(); // exits the process on invalid/missing config — must run before anything else

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.enableCors({
    origin: [env.APP_URL, env.WIDGET_ORIGIN],
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());

  await app.listen(env.PORT);
}

bootstrap();
