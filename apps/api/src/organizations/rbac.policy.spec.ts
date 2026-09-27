import { describe, expect, it } from "vitest";
import type { Role } from "@helpflow/database";
import { canManageMember } from "./rbac.policy";

const ROLES: Role[] = ["OWNER", "ADMIN", "AGENT"];

describe("canManageMember (Section 9 RBAC matrix)", () => {
  it("nobody can manage the OWNER through this policy, regardless of actor or new role", () => {
    for (const actor of ROLES) {
      for (const newRole of [...ROLES, null]) {
        expect(canManageMember(actor, "OWNER", newRole)).toBe(false);
      }
    }
  });

  it("OWNER is never granted through invite/change-role, even by another OWNER", () => {
    for (const actor of ROLES) {
      for (const target of ["ADMIN", "AGENT"] as Role[]) {
        expect(canManageMember(actor, target, "OWNER")).toBe(false);
      }
    }
  });

  it("OWNER can invite, change role of, or remove ADMIN and AGENT members", () => {
    for (const target of ["ADMIN", "AGENT"] as Role[]) {
      expect(canManageMember("OWNER", target, "ADMIN")).toBe(true);
      expect(canManageMember("OWNER", target, "AGENT")).toBe(true);
      expect(canManageMember("OWNER", target, null)).toBe(true);
    }
  });

  it("ADMIN can manage ADMIN and AGENT members (including peer admins), never the OWNER", () => {
    for (const target of ["ADMIN", "AGENT"] as Role[]) {
      expect(canManageMember("ADMIN", target, "ADMIN")).toBe(true);
      expect(canManageMember("ADMIN", target, "AGENT")).toBe(true);
      expect(canManageMember("ADMIN", target, null)).toBe(true);
    }
    expect(canManageMember("ADMIN", "OWNER", "ADMIN")).toBe(false);
  });

  it("AGENT can never manage another member", () => {
    for (const target of ["ADMIN", "AGENT"] as Role[]) {
      expect(canManageMember("AGENT", target, "ADMIN")).toBe(false);
      expect(canManageMember("AGENT", target, "AGENT")).toBe(false);
      expect(canManageMember("AGENT", target, null)).toBe(false);
    }
  });
});
