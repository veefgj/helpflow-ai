import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { loadEnv } from "@helpflow/config";
import { HealthModule } from "./health/health.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        genReqId: (req: any) => req.requestId,
        // Never log tokens, secrets or message content (Section 9 "Secrets / logging").
        redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
        customProps: (req: any) => ({
          requestId: req.requestId,
          organizationId: req.organizationId,
          userId: req.userId,
        }),
      },
    }),
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
