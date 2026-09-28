"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Clock, FileText, RotateCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatbotKnowledgeBases } from "@/hooks/use-knowledge-bases";
import { useDeleteDocument, useDocuments, useRetryDocument, useUploadDocument } from "@/hooks/use-documents";
import { ApiRequestError } from "@/lib/api-client";
import type { DocumentStatus } from "@/lib/types";

const STATUS_META: Record<DocumentStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  READY: { label: "Ready", icon: CheckCircle2, className: "text-green-600 dark:text-green-500" },
  UPLOADED: { label: "Queued", icon: Clock, className: "text-muted-foreground" },
  PROCESSING: { label: "Processing", icon: Clock, className: "text-amber-600 dark:text-amber-500" },
  FAILED: { label: "Failed", icon: AlertCircle, className: "text-destructive" },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeBasePanel({ orgId, chatbotId }: { orgId: string; chatbotId: string }) {
  const { data: kbs, isLoading: kbsLoading } = useChatbotKnowledgeBases(orgId, chatbotId);
  const kb = kbs?.[0];
  const { data: documents, isLoading: docsLoading } = useDocuments(orgId, kb?.id);
  const upload = useUploadDocument(orgId, kb?.id);
  const retry = useRetryDocument(orgId, kb?.id);
  const remove = useDeleteDocument(orgId, kb?.id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    upload.mutate(file, {
      onSuccess: () => toast.success(`Uploaded ${file.name} — processing…`),
      onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : "Upload failed"),
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{kb?.name ?? "Knowledge base"}</CardTitle>
          <CardDescription>PDF or TXT, up to 20MB. The AI only answers from what&apos;s uploaded here.</CardDescription>
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,.txt" className="hidden" onChange={handleFileSelected} />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending || !kb}
          className="shrink-0 transition-transform active:scale-95"
        >
          <Upload className="size-4" />
          {upload.isPending ? "Uploading…" : "Upload document"}
        </Button>
      </CardHeader>
      <CardContent>
        {(kbsLoading || docsLoading) && (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full animate-pulse rounded-lg" />
            ))}
          </div>
        )}

        {!kbsLoading && !docsLoading && documents?.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <FileText className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No documents yet — upload one to start grounding answers.</p>
          </div>
        )}

        {!kbsLoading && !docsLoading && documents && documents.length > 0 && (
          <ul className="divide-y">
            {documents.map((doc, i) => {
              const meta = STATUS_META[doc.status];
              return (
                <li
                  key={doc.id}
                  className="animate-in fade-in flex items-center justify-between gap-3 py-3 duration-200"
                  style={{ animationDelay: `${i * 30}ms`, animationFillMode: "backwards" }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{doc.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(doc.sizeBytes)}
                        {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className={meta.className}>
                      <meta.icon className="size-3" />
                      {meta.label}
                    </Badge>
                    {doc.status === "FAILED" && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(doc.id, { onSuccess: () => toast.success("Retrying…") })}
                      >
                        <RotateCw className="size-4" />
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(doc.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
