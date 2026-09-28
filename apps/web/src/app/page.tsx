"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { useMe } from "@/hooks/use-auth";

export default function RootRedirectPage() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const { data: me, isLoading } = useMe();

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (isLoading) return;
    if (!me) return;
    if (me.memberships.length === 0) {
      router.replace("/orgs/new");
      return;
    }
    router.replace(`/orgs/${me.memberships[0]!.organizationId}/chatbots`);
  }, [accessToken, hasHydrated, isLoading, me, router]);

  return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
}
