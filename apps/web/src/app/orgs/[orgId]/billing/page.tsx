"use client";

import { use } from "react";
import { toast } from "sonner";
import { ArrowUpRight, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateCheckout, useCreatePortalSession, useSubscription, useUsage } from "@/hooks/use-billing";
import { ApiRequestError } from "@/lib/api-client";

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString()} {limit !== null ? `/ ${limit.toLocaleString()}` : "(unlimited)"}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${pct > 90 ? "bg-destructive" : "bg-primary"}`}
          style={{ width: limit === null ? "8%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BillingPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const { data: usage, isLoading: usageLoading } = useUsage(orgId);
  const { data: subscription } = useSubscription(orgId);
  const checkout = useCreateCheckout(orgId);
  const portal = useCreatePortalSession(orgId);

  async function handleUpgrade() {
    try {
      const { url } = await checkout.mutateAsync("PRO");
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not start checkout");
    }
  }

  async function handlePortal() {
    try {
      const { url } = await portal.mutateAsync();
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Could not open billing portal");
    }
  }

  const planCode = subscription?.plan.code ?? "FREE";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing &amp; usage</h1>
        <p className="text-sm text-muted-foreground">Current period consumption and plan.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Plan
              <Badge variant={planCode === "FREE" ? "outline" : "default"}>{planCode}</Badge>
            </CardTitle>
            <CardDescription>
              {planCode === "FREE" ? "Upgrade for higher limits and priority support." : "Manage payment method or cancel any time."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardFooter className="gap-2">
          {planCode === "FREE" ? (
            <Button onClick={handleUpgrade} disabled={checkout.isPending} className="transition-transform active:scale-95">
              <ArrowUpRight className="size-4" />
              {checkout.isPending ? "Redirecting…" : "Upgrade to Pro"}
            </Button>
          ) : (
            <Button variant="outline" onClick={handlePortal} disabled={portal.isPending}>
              <CreditCard className="size-4" />
              {portal.isPending ? "Redirecting…" : "Manage billing"}
            </Button>
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current period</CardTitle>
          <CardDescription>
            {usage ? `${new Date(usage.period.start).toLocaleDateString()} – ${new Date(usage.period.end).toLocaleDateString()}` : " "}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usageLoading || !usage ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-full animate-pulse" />
              <Skeleton className="h-6 w-full animate-pulse" />
            </div>
          ) : (
            <>
              <UsageBar label="AI tokens" used={usage.aiTokens.used} limit={usage.aiTokens.limit} />
              <UsageBar label="Conversations" used={usage.conversations.used} limit={usage.conversations.limit} />
              <div className="flex items-baseline justify-between border-t pt-4 text-sm">
                <span className="font-medium">Estimated cost</span>
                <span className="text-muted-foreground">${(usage.estimatedCostMicros / 1_000_000).toFixed(2)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {usage && usage.chatbotsDaily.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s usage per chatbot</CardTitle>
            <CardDescription>Daily token cap resets at UTC midnight.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {usage.chatbotsDaily.map((bot) => (
              <UsageBar key={bot.chatbotId} label={bot.name} used={bot.used} limit={bot.cap} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
