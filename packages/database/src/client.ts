import { PrismaClient } from "@prisma/client";

export type CreatePrismaClientOptions = {
  /** PostgreSQL connection URL. Defaults to `process.env.DATABASE_URL`. */
  datasourceUrl?: string;
};

/**
 * Create an injectable Prisma client for the Radar IA database package.
 */
export function createPrismaClient(
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  const datasourceUrl = options.datasourceUrl ?? process.env.DATABASE_URL;

  if (datasourceUrl === undefined || datasourceUrl.trim() === "") {
    return new PrismaClient();
  }

  return new PrismaClient({
    datasources: {
      db: { url: datasourceUrl },
    },
  });
}
