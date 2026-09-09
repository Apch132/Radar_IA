-- CreateTable
CREATE TABLE "NormalizedArticle" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceTier" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "author" TEXT,
    "summary" TEXT,
    "content" TEXT,
    "categories" TEXT[],
    "feedFormat" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "persistedUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormalizedArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (lookup by source / date)
CREATE INDEX "NormalizedArticle_sourceId_idx" ON "NormalizedArticle"("sourceId");

-- CreateIndex
CREATE INDEX "NormalizedArticle_sourceId_publishedAt_idx" ON "NormalizedArticle"("sourceId", "publishedAt");

-- Technical identity when externalId is present: sourceId + externalId
-- (not expressible as a Prisma @@unique; partial unique index)
CREATE UNIQUE INDEX "NormalizedArticle_sourceId_externalId_key"
ON "NormalizedArticle"("sourceId", "externalId")
WHERE "externalId" IS NOT NULL;

-- Technical identity fallback when externalId is absent: sourceId + url
-- (URL is never globally unique; same URL allowed across sources)
CREATE UNIQUE INDEX "NormalizedArticle_sourceId_url_key"
ON "NormalizedArticle"("sourceId", "url")
WHERE "externalId" IS NULL;
