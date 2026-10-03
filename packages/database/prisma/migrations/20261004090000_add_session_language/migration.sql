-- CreateEnum
CREATE TYPE "Language" AS ENUM ('vi', 'en');

-- AlterTable
ALTER TABLE "chatbots" ADD COLUMN "defaultLanguage" "Language" NOT NULL DEFAULT 'vi';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "language" "Language";
