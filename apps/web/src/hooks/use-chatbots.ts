"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Chatbot, UnavailablePolicy } from "@/lib/types";

export function useChatbots(orgId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "chatbots"],
    queryFn: () => apiFetch<Chatbot[]>(`/api/orgs/${orgId}/chatbots`),
  });
}

export function useChatbot(orgId: string, chatbotId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "chatbots", chatbotId],
    queryFn: () => apiFetch<Chatbot>(`/api/orgs/${orgId}/chatbots/${chatbotId}`),
    enabled: !!chatbotId,
  });
}

export function useCreateChatbot(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => apiFetch<Chatbot>(`/api/orgs/${orgId}/chatbots`, { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "chatbots"] }),
  });
}

export interface UpdateChatbotInput {
  name?: string;
  description?: string;
  welcomeMessage?: string;
  systemPrompt?: string;
  temperature?: number;
  allowedDomains?: string[];
  dailyTokenCap?: number;
  handoffTimeoutSec?: number;
  unavailablePolicy?: UnavailablePolicy;
}

export function useUpdateChatbot(orgId: string, chatbotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateChatbotInput) => apiFetch<Chatbot>(`/api/orgs/${orgId}/chatbots/${chatbotId}`, { method: "PATCH", body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "chatbots", chatbotId] });
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "chatbots"] });
    },
  });
}

export function useDeleteChatbot(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatbotId: string) => apiFetch<void>(`/api/orgs/${orgId}/chatbots/${chatbotId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "chatbots"] }),
  });
}

export function useEmbedSnippet(orgId: string, chatbotId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "chatbots", chatbotId, "embed"],
    queryFn: () => apiFetch<{ chatbotId: string; snippet: string }>(`/api/orgs/${orgId}/chatbots/${chatbotId}/embed`),
    enabled: !!chatbotId,
  });
}

export function useAttachKnowledgeBase(orgId: string, chatbotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => apiFetch<void>(`/api/orgs/${orgId}/chatbots/${chatbotId}/knowledge-bases/${kbId}`, { method: "PUT" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "chatbots", chatbotId] }),
  });
}

export function useDetachKnowledgeBase(orgId: string, chatbotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kbId: string) => apiFetch<void>(`/api/orgs/${orgId}/chatbots/${chatbotId}/knowledge-bases/${kbId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "chatbots", chatbotId] }),
  });
}
