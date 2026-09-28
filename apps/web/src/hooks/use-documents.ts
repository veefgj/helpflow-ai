"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { DocumentRow } from "@/lib/types";

export function useDocuments(orgId: string, kbId: string | undefined) {
  return useQuery({
    queryKey: ["orgs", orgId, "knowledge-bases", kbId, "documents"],
    queryFn: () => apiFetch<DocumentRow[]>(`/api/orgs/${orgId}/knowledge-bases/${kbId}/documents`),
    enabled: !!kbId,
    // Poll while ingestion is in flight so status flips from UPLOADED/PROCESSING to READY/FAILED live.
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === "UPLOADED" || d.status === "PROCESSING") ? 2_000 : false),
  });
}

export function useUploadDocument(orgId: string, kbId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetch<DocumentRow>(`/api/orgs/${orgId}/knowledge-bases/${kbId}/documents`, { method: "POST", body: form });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "knowledge-bases", kbId, "documents"] }),
  });
}

export function useRetryDocument(orgId: string, kbId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => apiFetch<{ ok: boolean }>(`/api/orgs/${orgId}/documents/${documentId}/retry`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "knowledge-bases", kbId, "documents"] }),
  });
}

export function useDeleteDocument(orgId: string, kbId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => apiFetch<void>(`/api/orgs/${orgId}/documents/${documentId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "knowledge-bases", kbId, "documents"] }),
  });
}
