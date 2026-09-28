"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "OWNER" | "ADMIN" | "AGENT";
  disabledReason: "USER" | "PLAN_LIMIT" | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  memberships: MembershipSummary[];
}

interface AuthState {
  accessToken: string | null;
  user: CurrentUser | null;
  hasHydrated: boolean;
  setSession: (accessToken: string, user: CurrentUser) => void;
  setAccessToken: (accessToken: string) => void;
  clear: () => void;
  setHasHydrated: (value: boolean) => void;
}

// Only the access token and the (non-sensitive) user/membership summary are persisted — the
// refresh token itself lives only in the httpOnly cookie the API sets, never in JS-reachable storage.
//
// `hasHydrated` matters on a full page load/refresh (not a client-side <Link> navigation): zustand's
// persist middleware reads localStorage asynchronously, so accessToken is still null for the very
// first render. Anything that redirects to /login when accessToken is null must wait for
// hasHydrated first, or it bounces an already-logged-in visitor before the real token loads.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      hasHydrated: false,
      setSession: (accessToken, user) => set({ accessToken, user }),
      setAccessToken: (accessToken) => set({ accessToken }),
      clear: () => set({ accessToken: null, user: null }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "hf_auth",
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
      partialize: (state) => ({ accessToken: state.accessToken, user: state.user }),
    },
  ),
);
