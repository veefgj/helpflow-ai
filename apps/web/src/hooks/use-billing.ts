"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Subscription, UsageSummary } from "@/lib/types";

export function useUsage(orgId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "usage"],
    queryFn: () => apiFetch<UsageSummary>(`/api/orgs/${orgId}/usage`),
  });
}

export function useSubscription(orgId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "billing", "subscription"],
    queryFn: () => apiFetch<Subscription | null>(`/api/orgs/${orgId}/billing/subscription`),
  });
}

export function useCreateCheckout(orgId: string) {
  return useMutation({
    mutationFn: (planCode: "PRO") => apiFetch<{ url: string }>(`/api/orgs/${orgId}/billing/checkout`, { method: "POST", body: { planCode } }),
  });
}

export function useCreatePortalSession(orgId: string) {
  return useMutation({
    mutationFn: () => apiFetch<{ url: string }>(`/api/orgs/${orgId}/billing/portal`, { method: "POST" }),
  });
}

export function useActivatePlanResources(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: "chatbots" | "documents" | "agents"; ids: string[] }) =>
      apiFetch<void>(`/api/orgs/${orgId}/plan-resources/activate`, { method: "POST", body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "chatbots"] });
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "members"] });
    },
  });
}
