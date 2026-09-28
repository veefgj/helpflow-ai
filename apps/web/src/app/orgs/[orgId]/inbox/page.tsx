"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Inbox as InboxIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConversationStatusBadge } from "@/components/conversation-status-badge";
import { useConversations } from "@/hooks/use-conversations";
import { initials } from "@/lib/utils";

type Filter = "waiting" | "mine" | "all";

export default function InboxPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const [filter, setFilter] = useState<Filter>("waiting");
  const { data: conversations, isLoading } = useConversations(
    orgId,
    filter === "waiting" ? { status: "WAITING_AGENT" } : filter === "mine" ? { assignedToMe: true } : {},
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">Conversations handed off from the AI assistant.</p>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="waiting">Waiting</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && conversations?.length === 0 && (
        <Card className="animate-in fade-in flex flex-col items-center justify-center gap-3 border-dashed py-16 text-center duration-300">
          <InboxIcon className="size-10 text-muted-foreground" />
          <p className="font-medium">Nothing here</p>
          <p className="text-sm text-muted-foreground">
            {filter === "waiting" ? "No conversations are waiting for an agent right now." : "No conversations match this filter."}
          </p>
        </Card>
      )}

      {!isLoading && conversations && conversations.length > 0 && (
        <div className="space-y-2">
          {conversations.map((c, i) => (
            <Link
              key={c.id}
              href={`/orgs/${orgId}/inbox/${c.id}`}
              className="animate-in fade-in slide-in-from-bottom-1 block duration-300"
              style={{ animationDelay: `${i * 30}ms`, animationFillMode: "backwards" }}
            >
              <Card className="transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm">
                <CardContent className="flex items-center gap-4 py-1">
                  <Avatar className="size-9">
                    <AvatarFallback>{initials(c.customerName ?? "Visitor")}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.customerName ?? c.customerEmail ?? "Anonymous visitor"}</p>
                    <p className="text-xs text-muted-foreground">Last activity {new Date(c.lastMessageAt).toLocaleString()}</p>
                  </div>
                  <ConversationStatusBadge status={c.status} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
