// HelpFlow AI — seeds the `plans` table from DEFAULTS.plans (packages/config/defaults.ts).
// Safe to re-run: upserts by unique `code`. Env vars come from `--env-file-if-exists` (package.json).
import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULTS } from "@helpflow/config/defaults";
import { PrismaClient, type PlanCode } from "../generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const plans: Array<{ code: PlanCode; name: string; def: (typeof DEFAULTS)["plans"][keyof typeof DEFAULTS.plans]; stripePriceId?: string }> = [
    { code: "FREE", name: "Free", def: DEFAULTS.plans.FREE },
    { code: "PRO", name: "Pro", def: DEFAULTS.plans.PRO, stripePriceId: process.env.STRIPE_PRICE_ID_PRO },
    { code: "BUSINESS", name: "Business", def: DEFAULTS.plans.BUSINESS },
  ];

  for (const { code, name, def, stripePriceId } of plans) {
    await prisma.plan.upsert({
      where: { code },
      create: {
        code,
        name,
        maxChatbots: def.maxChatbots,
        maxAgents: def.maxAgents,
        maxDocuments: def.maxDocuments,
        monthlyAiTokens: def.monthlyAiTokens,
        monthlyConversations: def.monthlyConversations,
        selfServe: def.selfServe,
        stripePriceId,
      },
      update: {
        name,
        maxChatbots: def.maxChatbots,
        maxAgents: def.maxAgents,
        maxDocuments: def.maxDocuments,
        monthlyAiTokens: def.monthlyAiTokens,
        monthlyConversations: def.monthlyConversations,
        selfServe: def.selfServe,
        stripePriceId,
      },
    });
    console.log(`  ✓ plan ${code}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
