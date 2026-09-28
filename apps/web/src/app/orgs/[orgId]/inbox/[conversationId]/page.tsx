"use client";

import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bot, Send, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConversationStatusBadge } from "@/components/conversation-status-badge";
import { useAgentSocketContext } from "@/components/agent-socket-provider";
import { useMe } from "@/hooks/use-auth";
import {
  useAcceptConversation,
  useCloseConversation,
  useConversation,
  useConversationMessages,
  useReassignConversation,
  useReleaseConversation,
  useTakeoverConversation,
} from "@/hooks/use-conversations";
import { useWatchConversation } from "@/hooks/use-agent-socket";
import { useMembers } from "@/hooks/use-organizations";
import { ApiRequestError } from "@/lib/api-client";
import { initials } from "@/lib/utils";
import type { MessageDto } from "@helpflow/types";

function MessageBubble({ message }: { message: MessageDto }) {
  const isCustomer = message.senderType === "CUSTOMER";
  const isSystem = message.senderType === "SYSTEM";

  if (isSystem) {
    return <p className="py-1 text-center text-xs text-muted-foreground">{message.content}</p>;
  }

  return (
    <div className={`flex gap-2 ${isCustomer ? "" : "flex-row-reverse"}`}>
      <Avatar className="size-7 shrink-0">
        <AvatarFallback>{message.senderType === "AI" ? <Bot className="size-3.5" /> : message.senderType === "AGENT" ? "AG" : <UserRound className="size-3.5" />}</AvatarFallback>
      </Avatar>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
          isCustomer ? "bg-muted" : "bg-primary text-primary-foreground"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.citations && message.citations.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-0.5 border-t border-current/10 pt-1.5 text-xs opacity-70">
            {message.citations.map((c) => (
              <span key={c.index}>
                [{c.index}] {c.documentName}
                {c.pageNumber ? ` · p.${c.pageNumber}` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConversationDetailPage({ params }: { params: Promise<{ orgId: string; conversationId: string }> }) {
  const { orgId, conversationId } = use(params);
  const { data: me } = useMe();
  const { data: conversation, isLoading: convLoading } = useConversation(orgId, conversationId);
  const { data: messages, isLoading: messagesLoading } = useConversationMessages(orgId, conversationId);
  const { data: members } = useMembers(orgId);
  const { socket, sendMessage } = useAgentSocketContext();
  useWatchConversation(socket, conversationId);

  const accept = useAcceptConversation(orgId);
  const takeover = useTakeoverConversation(orgId);
  const release = useReleaseConversation(orgId);
  const close = useCloseConversation(orgId);
  const reassign = useReassignConversation(orgId);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const myUserId = me?.id;
  const myRole = me?.memberships.find((m) => m.organizationId === orgId)?.role;
  const isAssignedToMe = conversation?.assignedAgentId === myUserId;
  const canReply = conversation?.status === "AGENT_ACTIVE" && isAssignedToMe;
  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  async function handleSend() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    const result = await sendMessage({ conversationId, clientMessageId: crypto.randomUUID(), content });
    setSending(false);
    if (!result) {
      toast.error("Failed to send — you may no longer be assigned to this conversation");
      return;
    }
    setInput("");
  }

  if (convLoading || !conversation) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full animate-pulse" />
        <Skeleton className="h-96 w-full animate-pulse rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials(conversation.customerName ?? "Visitor")}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{conversation.customerName ?? conversation.customerEmail ?? "Anonymous visitor"}</p>
            <ConversationStatusBadge status={conversation.status} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conversation.status === "WAITING_AGENT" && (
            <Button onClick={() => accept.mutate(conversationId)} disabled={accept.isPending} className="transition-transform active:scale-95">
              {accept.isPending ? "Accepting…" : "Accept"}
            </Button>
          )}
          {conversation.status === "AGENT_ACTIVE" && isAssignedToMe && (
            <Button variant="outline" onClick={() => release.mutate(conversationId)} disabled={release.isPending}>
              Release
            </Button>
          )}
          {conversation.status === "AGENT_ACTIVE" && canManage && !isAssignedToMe && (
            <Button variant="outline" onClick={() => takeover.mutate(conversationId)} disabled={takeover.isPending}>
              Take over
            </Button>
          )}
          {conversation.status === "AGENT_ACTIVE" && canManage && members && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>Reassign</DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {members
                  .filter((m) => m.user.id !== conversation.assignedAgentId && !m.disabledReason)
                  .map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      className="cursor-pointer"
                      onClick={() => reassign.mutate({ conversationId, agentUserId: m.user.id })}
                    >
                      {m.user.name}
                      <Badge variant="outline" className="ml-auto">
                        {m.role}
                      </Badge>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {conversation.status !== "CLOSED" && (canManage || isAssignedToMe) && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                close.mutate(conversationId, {
                  onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : "Failed to close"),
                })
              }
              disabled={close.isPending}
            >
              Close
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto py-4">
        {messagesLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-2/3 animate-pulse rounded-2xl" />
            ))}
          </div>
        )}
        {messages?.items.map((m) => (
          <div key={m.id} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
            <MessageBubble message={m} />
          </div>
        ))}
      </div>

      {canReply ? (
        <div className="flex gap-2 border-t pt-4">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a reply…"
            disabled={sending}
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()} aria-label="Send message" className="transition-transform active:scale-95">
            <Send className="size-4" />
          </Button>
        </div>
      ) : (
        conversation.status !== "CLOSED" && (
          <p className="border-t pt-4 text-center text-sm text-muted-foreground">
            {conversation.status === "WAITING_AGENT" ? "Accept this conversation to reply." : "Only the assigned agent can reply."}
          </p>
        )
      )}
    </div>
  );
}
