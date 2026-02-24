// ============================================================
// Prisma Client singleton for server-side usage
// Prisma v7 requires a pg adapter for the "client" engine.
// ============================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
    const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;

    if (!connectionString) {
        // Allow build to succeed without DB — queries will fail at runtime
        console.warn("[prisma] No DATABASE_URL or DIRECT_URL set, using dummy adapter");
        return new PrismaClient({
            adapter: new PrismaPg({ connectionString: "postgresql://dummy:dummy@localhost:5432/dummy" }),
            log: ["error"],
        });
    }

    const adapter = new PrismaPg({ connectionString });
    return new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
