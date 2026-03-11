-- CreateTable
CREATE TABLE "rate_limit_entries" (
    "id" SERIAL NOT NULL,
    "bucket" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rate_limit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_rate_limit_bucket_key_window" ON "rate_limit_entries"("bucket", "key", "window_start");

-- CreateIndex
CREATE INDEX "idx_rate_limit_window_start" ON "rate_limit_entries"("window_start");
