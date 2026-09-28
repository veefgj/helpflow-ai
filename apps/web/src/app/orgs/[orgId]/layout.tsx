"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bot, CreditCard, Inbox, Users } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { OrgSwitcher } from "@/components/org-switcher";
import { NavUser } from "@/components/nav-user";
import { useAuthStore } from "@/lib/auth-store";
import { useMe } from "@/hooks/use-auth";
import { AgentSocketProvider } from "@/components/agent-socket-provider";

const NAV_ITEMS = [
  { label: "Chatbots", href: "chatbots", icon: Bot },
  { label: "Inbox", href: "inbox", icon: Inbox },
  { label: "Members", href: "members", icon: Users },
  { label: "Billing", href: "billing", icon: CreditCard },
];

export default function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const { data: me, isLoading } = useMe();

  const membership = me?.memberships.find((m) => m.organizationId === orgId);

  useEffect(() => {
    if (!hasHydrated) return; // wait for the persisted token to load before deciding anyone's logged out
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (!isLoading && me && !membership) {
      router.replace("/");
    }
  }, [accessToken, hasHydrated, isLoading, me, membership, router]);

  if (!hasHydrated || !accessToken || isLoading || !me || !membership) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-64 space-y-3">
          <Skeleton className="h-8 w-full animate-pulse" />
          <Skeleton className="h-8 w-3/4 animate-pulse" />
          <Skeleton className="h-8 w-5/6 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <AgentSocketProvider orgId={orgId}>
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <OrgSwitcher memberships={me.memberships} currentOrgId={orgId} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  const href = `/orgs/${orgId}/${item.href}`;
                  const isActive = pathname.startsWith(href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={<Link href={href} />}
                        className="transition-colors duration-150"
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavUser user={{ name: me.name, email: me.email }} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear">
          <SidebarTrigger className="-ml-1 transition-transform hover:scale-105" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium capitalize text-muted-foreground">
            {pathname.split("/").filter(Boolean).slice(2).join(" / ") || "Overview"}
          </span>
        </header>
        <main className="flex-1 animate-in fade-in duration-300 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
    </AgentSocketProvider>
  );
}
