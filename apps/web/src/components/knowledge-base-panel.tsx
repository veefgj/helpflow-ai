"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Clock, FileText, RotateCw, Trash2, Undo2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
  // Uploads and deletions are staged locally and only sent to the API on "Save changes".
  const [pendingFiles, setPendingFiles] = useState<{ key: string; file: File }[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const dirty = pendingFiles.length > 0 || pendingDeletes.size > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setPendingFiles((prev) => [...prev, ...files.map((file) => ({ key: crypto.randomUUID(), file }))]);
  }

  function toggleDelete(documentId: string) {
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      if (!next.delete(documentId)) next.add(documentId);
      return next;
    });
  }

  function discard() {
    setPendingFiles([]);
    setPendingDeletes(new Set());
  }

  // Deletes first (frees plan document slots), then one POST per file sequentially so each gets its
  // own validation/plan-limit result. Anything that fails stays staged so it can be retried or dropped.
  async function save() {
    setSaving(true);
    const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);
    let failed = 0;
    try {
      const keptDeletes = new Set<string>();
      for (const id of pendingDeletes) {
        try {
          await remove.mutateAsync(id);
        } catch (err) {
          failed++;
          keptDeletes.add(id);
          toast.error(errorMessage(err, "Delete failed"));
        }
      }
      setPendingDeletes(keptDeletes);

      const keptFiles: typeof pendingFiles = [];
      for (const entry of pendingFiles) {
        try {
          await upload.mutateAsync(entry.file);
        } catch (err) {
          failed++;
          keptFiles.push(entry);
          toast.error(`${entry.file.name}: ${errorMessage(err, "Upload failed")}`);
        }
      }
      setPendingFiles(keptFiles);

      if (failed === 0) toast.success("Knowledge base saved");
    } finally {
      setSaving(false);
    }
  }

  const isEmpty = documents?.length === 0 && pendingFiles.length === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Knowledge base</CardTitle>
          <CardDescription>PDF or TXT, up to 20MB. The AI only answers from what&apos;s uploaded here.</CardDescription>
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,.txt" multiple className="hidden" onChange={handleFilesSelected} />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={saving || !kb}
          className="shrink-0 transition-transform active:scale-95"
        >
          <Upload className="size-4" />
          Add documents
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

        {!kbsLoading && !docsLoading && isEmpty && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
            <FileText className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No documents yet — add one and save to start grounding answers.</p>
          </div>
        )}

        {!kbsLoading && !docsLoading && documents && !isEmpty && (
          <ul className="divide-y">
            {documents.map((doc, i) => {
              const meta = STATUS_META[doc.status];
              const markedForDelete = pendingDeletes.has(doc.id);
              return (
                <li
                  key={doc.id}
                  className="animate-in fade-in flex items-center justify-between gap-3 py-3 duration-200"
                  style={{ animationDelay: `${i * 30}ms`, animationFillMode: "backwards" }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${markedForDelete ? "text-muted-foreground line-through" : ""}`}>{doc.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(doc.sizeBytes)}
                        {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {markedForDelete ? (
                      <Badge variant="outline" className="text-destructive">
                        Will be removed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className={meta.className}>
                        <meta.icon className="size-3" />
                        {meta.label}
                      </Badge>
                    )}
                    {doc.status === "FAILED" && !markedForDelete && (
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
                      className={markedForDelete ? "" : "text-destructive hover:text-destructive"}
                      disabled={saving}
                      aria-label={markedForDelete ? "Undo remove" : "Remove"}
                      onClick={() => toggleDelete(doc.id)}
                    >
                      {markedForDelete ? <Undo2 className="size-4" /> : <Trash2 className="size-4" />}
                    </Button>
                  </div>
                </li>
              );
            })}
            {pendingFiles.map(({ key, file }) => (
              <li key={key} className="animate-in fade-in flex items-center justify-between gap-3 py-3 duration-200">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-amber-600 dark:text-amber-500">
                    Not saved
                  </Badge>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={saving}
                    aria-label="Remove from upload"
                    onClick={() => setPendingFiles((prev) => prev.filter((p) => p.key !== key))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={save} disabled={!dirty || saving} className="transition-transform active:scale-95">
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="outline" onClick={discard} disabled={!dirty || saving}>
          Discard
        </Button>
      </CardFooter>
    </Card>
  );
}
