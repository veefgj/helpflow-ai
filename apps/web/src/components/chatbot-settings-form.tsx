"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDeleteChatbot, useUpdateChatbot } from "@/hooks/use-chatbots";
import type { Chatbot } from "@/lib/types";
import { ApiRequestError } from "@/lib/api-client";

export function ChatbotSettingsForm({ orgId, chatbot }: { orgId: string; chatbot: Chatbot }) {
  const updateChatbot = useUpdateChatbot(orgId, chatbot.id);
  const deleteChatbot = useDeleteChatbot(orgId);
  const [form, setForm] = useState({
    name: chatbot.name,
    description: chatbot.description ?? "",
    welcomeMessage: chatbot.welcomeMessage ?? "",
    systemPrompt: chatbot.systemPrompt ?? "",
    allowedDomains: chatbot.allowedDomains.join(", "),
    unavailablePolicy: chatbot.unavailablePolicy,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    updateChatbot.mutate(
      {
        name,
        description: form.description,
        welcomeMessage: form.welcomeMessage,
        systemPrompt: form.systemPrompt,
        allowedDomains: form.allowedDomains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
        unavailablePolicy: form.unavailablePolicy,
      },
      {
        onSuccess: () => toast.success("Settings saved"),
        onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : "Failed to save"),
      },
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>How this chatbot introduces itself and where it can be embedded.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="welcome">Welcome message</Label>
              <Textarea
                id="welcome"
                rows={2}
                placeholder="Hi! How can I help you today?"
                value={form.welcomeMessage}
                onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt">System prompt</Label>
              <Textarea
                id="prompt"
                rows={4}
                placeholder="You are a helpful support assistant for..."
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">Layered below HelpFlow&apos;s own safety instructions — never overrides them.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="domains">Allowed domains</Label>
              <Input
                id="domains"
                placeholder="shop.example.com, *.example.com"
                value={form.allowedDomains}
                onChange={(e) => setForm({ ...form, allowedDomains: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Comma-separated. Empty means the widget can&apos;t be embedded anywhere.</p>
            </div>
            <div className="space-y-2">
              <Label>When no agent is available</Label>
              <Select value={form.unavailablePolicy} onValueChange={(v) => setForm({ ...form, unavailablePolicy: v as typeof form.unavailablePolicy })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RESUME_AI">Resume AI answers</SelectItem>
                  <SelectItem value="COLLECT_EMAIL">Collect the customer&apos;s email</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={updateChatbot.isPending} className="transition-transform active:scale-95">
              {updateChatbot.isPending ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Deleting a chatbot removes it and its embed immediately. This can&apos;t be undone.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Dialog>
            <DialogTrigger render={<Button variant="destructive" />}>
              <Trash2 className="size-4" />
              Delete chatbot
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete &quot;{chatbot.name}&quot;?</DialogTitle>
                <DialogDescription>This immediately stops the widget from responding anywhere it&apos;s embedded.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button
                  variant="destructive"
                  disabled={deleteChatbot.isPending}
                  onClick={() =>
                    deleteChatbot.mutate(chatbot.id, {
                      onSuccess: () => {
                        window.location.href = `/orgs/${orgId}/chatbots`;
                      },
                    })
                  }
                >
                  {deleteChatbot.isPending ? "Deleting…" : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardFooter>
      </Card>
    </div>
  );
}
