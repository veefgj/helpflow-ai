import { IsUUID } from "class-validator";

export class ReassignDto {
  @IsUUID()
  agentUserId!: string;
}
