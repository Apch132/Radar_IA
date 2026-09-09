-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('none', 'pending', 'partial', 'main_published', 'failed', 'inconsistent');

-- CreateEnum
CREATE TYPE "PublicationOperationKind" AS ENUM ('publish', 'create_thread', 'enrich', 'unarchive', 'reconcile');

-- CreateEnum
CREATE TYPE "PublicationAttemptStatus" AS ENUM ('reserved', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "PublicationErrorCode" AS ENUM ('folder_closed', 'precondition_failed', 'channel_unmapped', 'channel_unavailable', 'missing_permission', 'discord_rate_limited', 'discord_timeout', 'discord_unavailable', 'persist_failed', 'inconsistent_state', 'idempotent_hit', 'hold', 'reject_editorial', 'unknown');

-- CreateTable
CREATE TABLE "FolderPublication" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'none',
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "mainMessageId" TEXT,
    "threadId" TEXT,
    "sourceAnalysisAttemptId" TEXT,
    "lastErrorCode" "PublicationErrorCode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationAttempt" (
    "id" TEXT NOT NULL,
    "folderPublicationId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "kind" "PublicationOperationKind" NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "analysisAttemptId" TEXT,
    "eventFingerprint" TEXT,
    "status" "PublicationAttemptStatus" NOT NULL,
    "discordMessageId" TEXT,
    "discordThreadId" TEXT,
    "errorCode" "PublicationErrorCode",
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "nextAttemptAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FolderPublication_folderId_key" ON "FolderPublication"("folderId");

-- CreateIndex
CREATE INDEX "FolderPublication_status_idx" ON "FolderPublication"("status");

-- CreateIndex
CREATE INDEX "FolderPublication_status_updatedAt_idx" ON "FolderPublication"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "FolderPublication_folderId_status_idx" ON "FolderPublication"("folderId", "status");

-- CreateIndex
CREATE INDEX "FolderPublication_sourceAnalysisAttemptId_idx" ON "FolderPublication"("sourceAnalysisAttemptId");

-- CreateIndex
CREATE INDEX "PublicationAttempt_folderId_idx" ON "PublicationAttempt"("folderId");

-- CreateIndex
CREATE INDEX "PublicationAttempt_folderPublicationId_attemptedAt_idx" ON "PublicationAttempt"("folderPublicationId", "attemptedAt");

-- CreateIndex
CREATE INDEX "PublicationAttempt_folderId_attemptedAt_idx" ON "PublicationAttempt"("folderId", "attemptedAt");

-- CreateIndex
CREATE INDEX "PublicationAttempt_idempotencyKey_idx" ON "PublicationAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PublicationAttempt_eventFingerprint_idx" ON "PublicationAttempt"("eventFingerprint");

-- CreateIndex
CREATE INDEX "PublicationAttempt_status_retryable_nextAttemptAt_idx" ON "PublicationAttempt"("status", "retryable", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PublicationAttempt_folderId_kind_status_idx" ON "PublicationAttempt"("folderId", "kind", "status");

-- CreateIndex
CREATE INDEX "PublicationAttempt_analysisAttemptId_idx" ON "PublicationAttempt"("analysisAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationAttempt_idempotencyKey_attemptNumber_key" ON "PublicationAttempt"("idempotencyKey", "attemptNumber");

-- Partial unique: at most one active (reserved | succeeded) row per idempotency key (P01–P03).
CREATE UNIQUE INDEX "PublicationAttempt_idempotencyKey_active_key"
ON "PublicationAttempt"("idempotencyKey")
WHERE "status" IN ('reserved', 'succeeded');

-- AddForeignKey
ALTER TABLE "FolderPublication" ADD CONSTRAINT "FolderPublication_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "NewsFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderPublication" ADD CONSTRAINT "FolderPublication_sourceAnalysisAttemptId_fkey" FOREIGN KEY ("sourceAnalysisAttemptId") REFERENCES "AnalysisAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_folderPublicationId_fkey" FOREIGN KEY ("folderPublicationId") REFERENCES "FolderPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "NewsFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_analysisAttemptId_fkey" FOREIGN KEY ("analysisAttemptId") REFERENCES "AnalysisAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
