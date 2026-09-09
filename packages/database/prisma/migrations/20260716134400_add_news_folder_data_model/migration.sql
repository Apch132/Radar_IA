-- CreateEnum
CREATE TYPE "NewsFolderStatus" AS ENUM ('open', 'idle', 'closed');

-- CreateEnum
CREATE TYPE "NewsFolderArticleRole" AS ENUM ('primary', 'enrichment');

-- CreateEnum
CREATE TYPE "MatchingDecisionIssue" AS ENUM ('create_dossier', 'attach_enrich', 'duplicate_editorial', 'ambiguous_no_action');

-- CreateEnum
CREATE TYPE "MatchingConfidence" AS ENUM ('high', 'medium', 'low', 'none');

-- CreateTable
CREATE TABLE "NewsFolder" (
    "id" TEXT NOT NULL,
    "status" "NewsFolderStatus" NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "NewsFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsFolderArticle" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "role" "NewsFolderArticleRole" NOT NULL,
    "enrichmentType" TEXT,
    "enrichmentFacts" JSONB,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsFolderArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchingDecision" (
    "id" TEXT NOT NULL,
    "issue" "MatchingDecisionIssue" NOT NULL,
    "articleId" TEXT NOT NULL,
    "folderId" TEXT,
    "confidence" "MatchingConfidence" NOT NULL,
    "motiveCodes" TEXT[],
    "favorableSignals" TEXT[],
    "unfavorableSignals" TEXT[],
    "enrichmentFacts" JSONB,
    "proposalOrigin" TEXT,
    "reevaluable" BOOLEAN NOT NULL DEFAULT true,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsFolder_status_idx" ON "NewsFolder"("status");

-- CreateIndex
CREATE INDEX "NewsFolder_lastActivityAt_idx" ON "NewsFolder"("lastActivityAt");

-- CreateIndex
CREATE INDEX "NewsFolder_status_lastActivityAt_idx" ON "NewsFolder"("status", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsFolderArticle_articleId_key" ON "NewsFolderArticle"("articleId");

-- CreateIndex
CREATE INDEX "NewsFolderArticle_folderId_idx" ON "NewsFolderArticle"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsFolderArticle_folderId_articleId_key" ON "NewsFolderArticle"("folderId", "articleId");

-- CreateIndex
CREATE INDEX "MatchingDecision_articleId_decidedAt_idx" ON "MatchingDecision"("articleId", "decidedAt");

-- CreateIndex
CREATE INDEX "MatchingDecision_folderId_decidedAt_idx" ON "MatchingDecision"("folderId", "decidedAt");

-- CreateIndex
CREATE INDEX "MatchingDecision_issue_decidedAt_idx" ON "MatchingDecision"("issue", "decidedAt");

-- AddForeignKey (Restrict = suppression interdite si relations présentes)
ALTER TABLE "NewsFolderArticle" ADD CONSTRAINT "NewsFolderArticle_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "NewsFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsFolderArticle" ADD CONSTRAINT "NewsFolderArticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NormalizedArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchingDecision" ADD CONSTRAINT "MatchingDecision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NormalizedArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchingDecision" ADD CONSTRAINT "MatchingDecision_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "NewsFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
