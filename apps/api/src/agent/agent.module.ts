import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { AgentGateway } from "./agent.gateway";
import { AgentSocketTrackerService } from "./agent-socket-tracker.service";

@Module({
  imports: [AuthModule, ConversationsModule],
  providers: [AgentGateway, AgentSocketTrackerService],
})
export class AgentModule {}
