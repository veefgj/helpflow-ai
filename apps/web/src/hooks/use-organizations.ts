"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Invitation, Member, Organization, Role } from "@/lib/types";

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => apiFetch<Organization>("/api/orgs", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: ["orgs", orgId],
    queryFn: () => apiFetch<Organization>(`/api/orgs/${orgId}`),
  });
}

export function useMembers(orgId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "members"],
    queryFn: () => apiFetch<Member[]>(`/api/orgs/${orgId}/members`),
  });
}

export function useUpdateMemberRole(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Role }) =>
      apiFetch<Member>(`/api/orgs/${orgId}/members/${memberId}`, { method: "PATCH", body: { role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "members"] }),
  });
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => apiFetch<void>(`/api/orgs/${orgId}/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "members"] }),
  });
}

export function useTransferOwnership(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => apiFetch<void>(`/api/orgs/${orgId}/transfer-ownership`, { method: "POST", body: { memberId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useInvitations(orgId: string) {
  return useQuery({
    queryKey: ["orgs", orgId, "invitations"],
    queryFn: () => apiFetch<Invitation[]>(`/api/orgs/${orgId}/invitations`),
  });
}

export function useCreateInvitation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: "ADMIN" | "AGENT" }) =>
      apiFetch<Invitation & { inviteUrl: string }>(`/api/orgs/${orgId}/invitations`, { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "invitations"] }),
  });
}

export function useRevokeInvitation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => apiFetch<void>(`/api/orgs/${orgId}/invitations/${invitationId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs", orgId, "invitations"] }),
  });
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => apiFetch<{ organizationId: string }>("/api/invitations/accept", { method: "POST", body: { token } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
}
