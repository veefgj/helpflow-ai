// Section 9 "RBAC rules that matter": the single policy function covering invite / remove /
// change-role decisions, so every caller (member endpoints, invitation acceptance) agrees.
import type { Role } from "@helpflow/database";

/**
 * Can `actorRole` change a member currently holding `targetCurrentRole` to `newRole`
 * (or remove them, when `newRole` is null)?
 *
 * - The OWNER's own membership is never touched here — only via POST .../transfer-ownership —
 *   so any target currently OWNER is always unmanageable through this policy.
 * - OWNER is never a role granted through invite/change-role, only through transfer-ownership.
 * - ADMIN may manage ADMIN and AGENT members (including other admins); AGENT may manage no one.
 */
export function canManageMember(actorRole: Role, targetCurrentRole: Role, newRole: Role | null): boolean {
  if (targetCurrentRole === "OWNER") return false;
  if (newRole === "OWNER") return false;

  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") return true; // targetCurrentRole is already known to be ADMIN or AGENT here
  return false; // AGENT
}
