-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "CollectedSourceState" (
    "sourceId" TEXT NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastCollectedAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectedSourceState_pkey" PRIMARY KEY ("sourceId")
);

-- CreateTable
CREATE TABLE "RawFeedSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "finalUrl" TEXT,
    "feedFormat" TEXT,
    "rawBody" TEXT NOT NULL,
    "parseSucceeded" BOOLEAN NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "RawFeedSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawFeedSnapshot_sourceId_collectedAt_idx" ON "RawFeedSnapshot"("sourceId", "collectedAt");
