"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { KnowledgeBase } from "@/lib/types";

export function useKnowledgeBases(orgId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "knowledge-bases"],
    queryFn: () => apiFetch<KnowledgeBase[]>(`/api/orgs/${orgId}/knowledge-bases`),
  });
}

export function useChatbotKnowledgeBases(orgId: string, chatbotId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "chatbots", chatbotId, "knowledge-bases"],
    queryFn: () => apiFetch<KnowledgeBase[]>(`/api/orgs/${orgId}/chatbots/${chatbotId}/knowledge-bases`),
    enabled: !!chatbotId,
  });
}

export function useCreateKnowledgeBase(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => apiFetch<KnowledgeBase>(`/api/orgs/${orgId}/knowledge-bases`, { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "knowledge-bases"] }),
  });
}

export function useDeleteKnowledgeBase(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => apiFetch<void>(`/api/orgs/${orgId}/knowledge-bases/${kbId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "knowledge-bases"] }),
  });
}
