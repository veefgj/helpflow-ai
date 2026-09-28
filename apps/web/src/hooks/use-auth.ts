"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore, type CurrentUser } from "@/lib/auth-store";

export function useMe() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<CurrentUser>("/api/me"),
    enabled: !!accessToken,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiFetch<{ user: { id: string; email: string; name: string }; accessToken: string }>("/api/auth/login", {
        method: "POST",
        body: input,
      }),
    onSuccess: (data) => setSession(data.accessToken, { ...data.user, memberships: [] }),
  });
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (input: { email: string; password: string; name: string }) =>
      apiFetch<{ user: { id: string; email: string; name: string }; accessToken: string }>("/api/auth/register", {
        method: "POST",
        body: input,
      }),
    onSuccess: (data) => setSession(data.accessToken, { ...data.user, memberships: [] }),
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    onSettled: () => {
      clear();
      queryClient.clear();
    },
  });
}
