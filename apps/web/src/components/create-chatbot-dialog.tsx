"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useCreateChatbot } from "@/hooks/use-chatbots";
import { ApiRequestError } from "@/lib/api-client";

export function CreateChatbotDialog({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createChatbot = useCreateChatbot(orgId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createChatbot.mutate(
      { name },
      {
        onSuccess: () => {
          toast.success(`"${name}" created`);
          setName("");
          setOpen(false);
        },
        onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : "Failed to create chatbot"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="transition-transform active:scale-95" />}>
        <Plus className="size-4" />
        New chatbot
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create a chatbot</DialogTitle>
            <DialogDescription>A default knowledge base is created automatically — attach documents to it next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="chatbot-name">Name</Label>
            <Input id="chatbot-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Support Bot" />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={createChatbot.isPending}>
              {createChatbot.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
