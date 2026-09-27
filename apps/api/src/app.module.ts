import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { loadEnv } from "@helpflow/config";
import { HealthModule } from "./health/health.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { RedisModule } from "./common/redis/redis.module";
import { RealtimeModule } from "./common/realtime/realtime.module";
import { AuthGuard } from "./common/guards/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { QueuesModule } from "./common/queues/queues.module";
import { ChatbotsModule } from "./chatbots/chatbots.module";
import { KnowledgeBasesModule } from "./knowledge-bases/knowledge-bases.module";
import { DocumentsModule } from "./documents/documents.module";
import { WidgetModule } from "./widget/widget.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { AgentModule } from "./agent/agent.module";

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
          organizationId: req.params?.orgId,
          userId: req.userId,
        }),
      },
    }),
    RedisModule,
    RealtimeModule,
    QueuesModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    InvitationsModule,
    ChatbotsModule,
    KnowledgeBasesModule,
    DocumentsModule,
    WidgetModule,
    ConversationsModule,
    AgentModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
