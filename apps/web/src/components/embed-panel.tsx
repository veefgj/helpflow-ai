"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmbedSnippet } from "@/hooks/use-chatbots";

export function EmbedPanel({ orgId, chatbotId }: { orgId: string; chatbotId: string }) {
  const { data, isLoading } = useEmbedSnippet(orgId, chatbotId);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!data) return;
    await navigator.clipboard.writeText(data.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Embed on your site</CardTitle>
        <CardDescription>Paste this before the closing &lt;/body&gt; tag. Only allowed domains can load the widget.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-20 w-full animate-pulse rounded-lg" />
        ) : (
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs">
              <code>{data.snippet}</code>
            </pre>
            <Button
              size="icon-sm"
              variant="outline"
              className="absolute top-2 right-2 transition-transform active:scale-90"
              onClick={copy}
            >
              {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
