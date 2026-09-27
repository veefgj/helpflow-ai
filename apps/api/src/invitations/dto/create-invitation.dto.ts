import { IsEmail, IsIn } from "class-validator";
import type { Role } from "@helpflow/database";

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  /** OWNER is never invited — transfer ownership instead. */
  @IsIn(["ADMIN", "AGENT"])
  role!: Role;
}
