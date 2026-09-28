"use client";

import { use } from "react";
import Link from "next/link";
import { Bot, MessageSquareOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateChatbotDialog } from "@/components/create-chatbot-dialog";
import { useChatbots } from "@/hooks/use-chatbots";

export default function ChatbotsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const { data: chatbots, isLoading } = useChatbots(orgId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chatbots</h1>
          <p className="text-sm text-muted-foreground">Create and configure the AI assistants embedded on your sites.</p>
        </div>
        <CreateChatbotDialog orgId={orgId} />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 animate-pulse rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && chatbots?.length === 0 && (
        <Card className="animate-in fade-in flex flex-col items-center justify-center gap-3 border-dashed py-16 text-center duration-300">
          <MessageSquareOff className="size-10 text-muted-foreground" />
          <div>
            <p className="font-medium">No chatbots yet</p>
            <p className="text-sm text-muted-foreground">Create your first chatbot to start embedding it on your site.</p>
          </div>
        </Card>
      )}

      {!isLoading && chatbots && chatbots.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {chatbots.map((bot, i) => (
            <Link
              key={bot.id}
              href={`/orgs/${orgId}/chatbots/${bot.id}`}
              className="animate-in fade-in slide-in-from-bottom-1 group block duration-300"
              style={{ animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}
            >
              <Card className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                      <Bot className="size-5" />
                    </div>
                    {bot.disabledReason && (
                      <Badge variant="destructive">{bot.disabledReason === "PLAN_LIMIT" ? "Plan limit" : "Disabled"}</Badge>
                    )}
                  </div>
                  <CardTitle className="pt-2">{bot.name}</CardTitle>
                  <CardDescription className="line-clamp-2">{bot.description || "No description yet."}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {bot.allowedDomains.length === 0 ? (
                      <Badge variant="outline">Not embedded anywhere</Badge>
                    ) : (
                      bot.allowedDomains.slice(0, 3).map((d) => (
                        <Badge key={d} variant="secondary">
                          {d}
                        </Badge>
                      ))
                    )}
                    {bot.allowedDomains.length > 3 && <Badge variant="outline">+{bot.allowedDomains.length - 3}</Badge>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
