-- CreateEnum
CREATE TYPE "AnalysisValidationStatus" AS ENUM ('accepted', 'accepted_with_warnings', 'rejected');

-- CreateEnum
CREATE TYPE "PublicationDecision" AS ENUM ('publish', 'enrich_thread_only', 'hold', 'reject_editorial');

-- CreateEnum
CREATE TYPE "AnalysisErrorCode" AS ENUM ('not_eligible', 'enrichment_immaterial', 'queue_timeout', 'ollama_unavailable', 'inference_timeout', 'invalid_json', 'schema_violation', 'empty_summary', 'context_too_large', 'model_mismatch', 'analysis_exhausted');

-- CreateEnum
CREATE TYPE "AnalysisWarningCode" AS ENUM ('facts_dropped', 'entities_deduplicated');

-- CreateTable
CREATE TABLE "AnalysisAttempt" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "aggregateFingerprint" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelId" TEXT,
    "proposalOrigin" TEXT NOT NULL DEFAULT 'llm',
    "validationStatus" "AnalysisValidationStatus" NOT NULL,
    "proposal" JSONB,
    "backendScoring" JSONB,
    "errorCodes" "AnalysisErrorCode"[],
    "warnings" "AnalysisWarningCode"[],
    "droppedFacts" JSONB NOT NULL,
    "publicationDecision" "PublicationDecision",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisAttempt_folderId_idx" ON "AnalysisAttempt"("folderId");

-- CreateIndex
CREATE INDEX "AnalysisAttempt_folderId_aggregateFingerprint_idx" ON "AnalysisAttempt"("folderId", "aggregateFingerprint");

-- CreateIndex
CREATE INDEX "AnalysisAttempt_folderId_analyzedAt_idx" ON "AnalysisAttempt"("folderId", "analyzedAt");

-- CreateIndex
CREATE INDEX "AnalysisAttempt_folderId_validationStatus_analyzedAt_idx" ON "AnalysisAttempt"("folderId", "validationStatus", "analyzedAt");

-- CreateIndex
CREATE INDEX "AnalysisAttempt_folderId_aggregateFingerprint_publicationDecision_idx" ON "AnalysisAttempt"("folderId", "aggregateFingerprint", "publicationDecision");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisAttempt_folderId_aggregateFingerprint_attemptNumber_key" ON "AnalysisAttempt"("folderId", "aggregateFingerprint", "attemptNumber");

-- AddForeignKey (Restrict = suppression interdite si relations présentes)
ALTER TABLE "AnalysisAttempt" ADD CONSTRAINT "AnalysisAttempt_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "NewsFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
