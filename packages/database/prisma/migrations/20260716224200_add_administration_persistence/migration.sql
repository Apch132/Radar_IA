-- AlterTable: backoff runtime on CollectedSourceState (009.1B / R4 — extension)
ALTER TABLE "CollectedSourceState" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectedSourceState" ADD COLUMN "nextEligibleAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CollectedSourceState_nextEligibleAt_idx" ON "CollectedSourceState"("nextEligibleAt");

-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('running', 'completed', 'failed', 'degraded');

-- CreateEnum
CREATE TYPE "PipelineRunTrigger" AS ENUM ('scheduled', 'manual', 'cli');

-- CreateEnum
CREATE TYPE "AdminOperationKind" AS ENUM ('run_cycle', 'collect_source', 'force_reanalysis', 'resume_publication', 'force_retry_publication', 'reconcile', 'force_republish', 'set_folder_status', 'reconcile_ids', 'clear_source_backoff');

-- CreateEnum
CREATE TYPE "AdminOperationOutcome" AS ENUM ('accepted', 'rejected', 'succeeded', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "status" "PipelineRunStatus" NOT NULL,
    "trigger" "PipelineRunTrigger" NOT NULL,
    "holderId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineLock" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "holderId" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PipelineLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminOperationLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" "AdminOperationKind" NOT NULL,
    "target" JSONB NOT NULL,
    "outcome" "AdminOperationOutcome" NOT NULL,
    "detail" TEXT,
    "pipelineRunId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminOperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineRun_status_heartbeatAt_idx" ON "PipelineRun"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "PipelineRun_startedAt_idx" ON "PipelineRun"("startedAt");

-- CreateIndex
CREATE INDEX "PipelineRun_status_startedAt_idx" ON "PipelineRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "PipelineRun_holderId_startedAt_idx" ON "PipelineRun"("holderId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineLock_runId_key" ON "PipelineLock"("runId");

-- CreateIndex
CREATE INDEX "AdminOperationLog_requestedAt_idx" ON "AdminOperationLog"("requestedAt");

-- CreateIndex
CREATE INDEX "AdminOperationLog_actorId_requestedAt_idx" ON "AdminOperationLog"("actorId", "requestedAt");

-- CreateIndex
CREATE INDEX "AdminOperationLog_kind_requestedAt_idx" ON "AdminOperationLog"("kind", "requestedAt");

-- CreateIndex
CREATE INDEX "AdminOperationLog_pipelineRunId_idx" ON "AdminOperationLog"("pipelineRunId");

-- CreateIndex
CREATE INDEX "AdminOperationLog_outcome_requestedAt_idx" ON "AdminOperationLog"("outcome", "requestedAt");

-- AddForeignKey
ALTER TABLE "PipelineLock" ADD CONSTRAINT "PipelineLock_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminOperationLog" ADD CONSTRAINT "AdminOperationLog_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed singleton single-flight lock row
INSERT INTO "PipelineLock" ("id", "runId", "holderId", "acquiredAt", "heartbeatAt", "expiresAt")
VALUES ('global', NULL, NULL, NULL, NULL, NULL);
