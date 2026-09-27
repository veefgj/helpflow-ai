import { Module } from "@nestjs/common";
import { OrgInvitationsController, InvitationsAcceptController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

@Module({
  controllers: [OrgInvitationsController, InvitationsAcceptController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
