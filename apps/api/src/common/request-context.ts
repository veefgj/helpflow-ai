import type { Request } from "express";
import type { Membership } from "@helpflow/database";

/** Set by AuthGuard once the access JWT verifies. */
export type RequestWithUser = Request & { userId: string; userEmail: string };

/** Set by OrgMembershipGuard for every /api/orgs/:orgId/... route. */
export type RequestWithMembership = RequestWithUser & { membership: Membership };
