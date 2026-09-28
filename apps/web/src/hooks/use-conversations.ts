"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MessageDto } from "@helpflow/types";
import { apiFetch } from "@/lib/api-client";
import type { ConversationRow } from "@/lib/types";

export function useConversations(orgId: string, filters: { status?: string; assignedToMe?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.assignedToMe) params.set("assigned", "me");
  const qs = params.toString();
  return useQuery({
    queryKey: ["orgs", orgId, "conversations", filters],
    queryFn: () => apiFetch<ConversationRow[]>(`/api/orgs/${orgId}/conversations${qs ? `?${qs}` : ""}`),
    refetchInterval: 15_000,
  });
}

export function useConversation(orgId: string, conversationId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "conversations", conversationId],
    queryFn: () => apiFetch<ConversationRow>(`/api/orgs/${orgId}/conversations/${conversationId}`),
    enabled: !!conversationId,
  });
}

export function useConversationMessages(orgId: string, conversationId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "conversations", conversationId, "messages"],
    queryFn: () => apiFetch<{ items: MessageDto[] }>(`/api/orgs/${orgId}/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
  });
}

function useConversationAction(orgId: string, action: "accept" | "takeover" | "release" | "close") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<ConversationRow>(`/api/orgs/${orgId}/conversations/${conversationId}/${action}`, { method: "POST" }),
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "conversations"] });
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "conversations", conversationId] });
    },
  });
}

export const useAcceptConversation = (orgId: string) => useConversationAction(orgId, "accept");
export const useTakeoverConversation = (orgId: string) => useConversationAction(orgId, "takeover");
export const useReleaseConversation = (orgId: string) => useConversationAction(orgId, "release");
export const useCloseConversation = (orgId: string) => useConversationAction(orgId, "close");

export function useReassignConversation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, agentUserId }: { conversationId: string; agentUserId: string }) =>
      apiFetch<ConversationRow>(`/api/orgs/${orgId}/conversations/${conversationId}/reassign`, { method: "POST", body: { agentUserId } }),
    onSuccess: (_data, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "conversations"] });
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "conversations", conversationId] });
    },
  });
}
