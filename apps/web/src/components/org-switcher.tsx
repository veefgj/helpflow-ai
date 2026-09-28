"use client";

import { useRouter } from "next/navigation";
import { Building2, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { MembershipSummary } from "@/lib/auth-store";

export function OrgSwitcher({ memberships, currentOrgId }: { memberships: MembershipSummary[]; currentOrgId: string }) {
  const router = useRouter();
  const current = memberships.find((m) => m.organizationId === currentOrgId);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="transition-colors data-[state=open]:bg-sidebar-accent" />}
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{current?.organizationName ?? "Select workspace"}</span>
              <span className="truncate text-xs text-muted-foreground">{current?.role}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 opacity-50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem
                key={m.organizationId}
                onClick={() => router.push(`/orgs/${m.organizationId}/chatbots`)}
                className="cursor-pointer"
              >
                <Building2 className="size-4" />
                <span className="truncate">{m.organizationName}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/orgs/new")} className="cursor-pointer">
              <Plus className="size-4" />
              New workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
