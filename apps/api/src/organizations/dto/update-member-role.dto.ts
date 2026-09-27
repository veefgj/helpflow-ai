import { IsIn } from "class-validator";
import type { Role } from "@helpflow/database";

export class UpdateMemberRoleDto {
  @IsIn(["ADMIN", "AGENT"])
  role!: Role;
}
