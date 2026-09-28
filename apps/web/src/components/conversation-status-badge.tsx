import { Badge } from "@/components/ui/badge";
import type { ConversationStatus } from "@helpflow/types";

const STATUS_STYLE: Record<ConversationStatus, string> = {
  AI_ACTIVE: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-transparent",
  WAITING_AGENT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent animate-pulse",
  AGENT_ACTIVE: "bg-green-500/10 text-green-600 dark:text-green-400 border-transparent",
  CLOSED: "",
};

const STATUS_LABEL: Record<ConversationStatus, string> = {
  AI_ACTIVE: "AI active",
  WAITING_AGENT: "Waiting for agent",
  AGENT_ACTIVE: "Agent active",
  CLOSED: "Closed",
};

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
  return (
    <Badge variant={status === "CLOSED" ? "outline" : "default"} className={STATUS_STYLE[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
