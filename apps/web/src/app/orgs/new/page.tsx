"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateOrganization } from "@/hooks/use-organizations";
import { useAuthStore } from "@/lib/auth-store";
import { ApiRequestError } from "@/lib/api-client";

export default function NewOrganizationPage() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const createOrg = useCreateOrganization();
  const [name, setName] = useState("");

  useEffect(() => {
    if (hasHydrated && !accessToken) router.replace("/login");
  }, [accessToken, hasHydrated, router]);

  if (!hasHydrated || !accessToken) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createOrg.mutate(
      { name },
      { onSuccess: (org) => router.push(`/orgs/${org.id}/chatbots`) },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your workspace</CardTitle>
          <CardDescription>This becomes your organization on the Free plan — upgrade any time.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {createOrg.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {createOrg.error instanceof ApiRequestError ? createOrg.error.message : "Something went wrong"}
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Workspace name</Label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Support" />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={createOrg.isPending}>
              {createOrg.isPending ? "Creating…" : "Create workspace"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
