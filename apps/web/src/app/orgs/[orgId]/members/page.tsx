"use client";

import { use } from "react";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { useMe } from "@/hooks/use-auth";
import { useInvitations, useMembers, useRemoveMember, useRevokeInvitation, useTransferOwnership, useUpdateMemberRole } from "@/hooks/use-organizations";
import { ApiRequestError } from "@/lib/api-client";
import { initials } from "@/lib/utils";

export default function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const { data: me } = useMe();
  const { data: members, isLoading } = useMembers(orgId);
  const { data: invitations } = useInvitations(orgId);
  const updateRole = useUpdateMemberRole(orgId);
  const removeMember = useRemoveMember(orgId);
  const transferOwnership = useTransferOwnership(orgId);
  const revokeInvitation = useRevokeInvitation(orgId);

  const myRole = me?.memberships.find((m) => m.organizationId === orgId)?.role;
  const isOwner = myRole === "OWNER";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-muted-foreground">Who has access to this workspace.</p>
        </div>
        <InviteMemberDialog orgId={orgId} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full animate-pulse" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members?.map((member) => (
                  <TableRow key={member.id} className="animate-in fade-in duration-200">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarFallback>{initials(member.user.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{member.user.name}</p>
                          <p className="text-xs text-muted-foreground">{member.user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>{member.role}</Badge>
                        {member.disabledReason && <Badge variant="destructive">{member.disabledReason}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(member.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {member.role !== "OWNER" && (isOwner || myRole === "ADMIN") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" />}>
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="cursor-pointer"
                              onClick={() => updateRole.mutate({ memberId: member.id, role: member.role === "ADMIN" ? "AGENT" : "ADMIN" })}
                            >
                              Make {member.role === "ADMIN" ? "Agent" : "Admin"}
                            </DropdownMenuItem>
                            {isOwner && (
                              <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() =>
                                  transferOwnership.mutate(member.id, {
                                    onSuccess: () => toast.success(`${member.user.name} is now the owner`),
                                  })
                                }
                              >
                                Transfer ownership
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="cursor-pointer text-destructive focus:text-destructive"
                              onClick={() =>
                                removeMember.mutate(member.id, {
                                  onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : "Failed to remove"),
                                })
                              }
                            >
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {invitations && invitations.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Pending invitations</h2>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableBody>
                  {invitations.map((invite) => (
                    <TableRow key={invite.id} className="animate-in fade-in duration-200">
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{invite.role}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Expires {new Date(invite.expiresAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => revokeInvitation.mutate(invite.id)}>
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
