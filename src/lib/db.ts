import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  conservaPrisma?: PrismaClient;
};

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPrisma() {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is required for persisted settings and report runs.");
  }

  if (!globalForPrisma.conservaPrisma) {
    globalForPrisma.conservaPrisma = new PrismaClient();
  }

  return globalForPrisma.conservaPrisma;
}
