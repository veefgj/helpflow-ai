// HelpFlow AI — shared Prisma client singleton. Repositories (added from Phase 1 onward) import
// `prisma` from here; raw SQL access always goes through prisma.$queryRaw / $executeRaw so it shares
// the same connection pool and transaction context as ORM calls.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

declare global {
  var __helpflowPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = global.__helpflowPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.__helpflowPrisma = prisma;
}

export * from "./generated/prisma/client";
