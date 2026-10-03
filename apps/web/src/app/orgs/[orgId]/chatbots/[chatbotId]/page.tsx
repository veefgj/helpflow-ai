"use client";

import { use } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatbotSettingsForm } from "@/components/chatbot-settings-form";
import { KnowledgeBasePanel } from "@/components/knowledge-base-panel";
import { EmbedPanel } from "@/components/embed-panel";
import { useChatbot } from "@/hooks/use-chatbots";

export default function ChatbotDetailPage({ params }: { params: Promise<{ orgId: string; chatbotId: string }> }) {
  const { orgId, chatbotId } = use(params);
  const { data: chatbot, isLoading } = useChatbot(orgId, chatbotId);

  if (isLoading || !chatbot) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 animate-pulse" />
        <Skeleton className="h-64 w-full animate-pulse rounded-xl" />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in space-y-6 duration-300">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{chatbot.name}</h1>
        <p className="text-sm text-muted-foreground">Configure behavior, knowledge and embedding for this chatbot.</p>
      </div>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge base</TabsTrigger>
          <TabsTrigger value="embed">Embed</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="animate-in fade-in duration-200">
          <ChatbotSettingsForm orgId={orgId} chatbot={chatbot} />
        </TabsContent>
        <TabsContent value="knowledge" keepMounted className="animate-in fade-in duration-200">
          <KnowledgeBasePanel orgId={orgId} chatbotId={chatbotId} />
        </TabsContent>
        <TabsContent value="embed" className="animate-in fade-in duration-200">
          <EmbedPanel orgId={orgId} chatbotId={chatbotId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
