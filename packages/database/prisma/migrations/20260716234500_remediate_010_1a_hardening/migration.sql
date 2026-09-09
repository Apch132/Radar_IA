-- 010.1A — Hardening post-audit (AUD-002, AUD-003, AUD-008 support, AUD-015)

-- AUD-002: execution lease on publication attempts
ALTER TABLE "PublicationAttempt" ADD COLUMN "executionHolderId" TEXT;
ALTER TABLE "PublicationAttempt" ADD COLUMN "executionLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "PublicationAttempt_executionLease_idx"
ON "PublicationAttempt"("status", "executionLeaseExpiresAt");

-- AUD-003: cross-process Ollama inference lock (singleton)
CREATE TABLE "InferenceLock" (
    "id" TEXT NOT NULL,
    "holderId" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),

    CONSTRAINT "InferenceLock_pkey" PRIMARY KEY ("id")
);

INSERT INTO "InferenceLock" ("id", "holderId", "acquiredAt", "expiresAt", "heartbeatAt")
VALUES ('ollama', NULL, NULL, NULL, NULL);

-- AUD-015: GIN index for admin containment queries on errorCodes
CREATE INDEX "AnalysisAttempt_errorCodes_gin_idx"
ON "AnalysisAttempt" USING GIN ("errorCodes");

-- AUD-008 support: index for retention purge by source + time
CREATE INDEX IF NOT EXISTS "RawFeedSnapshot_sourceId_collectedAt_idx"
ON "RawFeedSnapshot"("sourceId", "collectedAt" DESC);
