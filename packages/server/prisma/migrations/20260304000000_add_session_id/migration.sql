-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "session_id" VARCHAR(36) NOT NULL DEFAULT 'legacy';

-- Remove default after backfill
ALTER TABLE "tasks" ALTER COLUMN "session_id" DROP DEFAULT;
