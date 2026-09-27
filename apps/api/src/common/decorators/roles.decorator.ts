import { SetMetadata } from "@nestjs/common";
import type { Role } from "@helpflow/database";

export const ROLES_KEY = "roles";

/** Requires the caller's membership role (attached by OrgMembershipGuard) to be one of these. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
