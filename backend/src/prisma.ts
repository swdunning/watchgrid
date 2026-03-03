import "./config/env"
// backend/src/prisma.ts
import { PrismaClient } from "@prisma/client"

/**
 * Teaching moment (Node/Prisma):
 * - process.env.DATABASE_URL is read from Railway "Variables" at runtime.
 * - Passing it via `datasources` makes Prisma’s config explicit (no “magic”).
 * - If DATABASE_URL is missing/empty, we throw immediately with a clear error.
 */
const url = process.env.DATABASE_URL
if (!url) {
	throw new Error("DATABASE_URL is missing in Railway Variables for the backend service.")
}

export const prisma = new PrismaClient({
	datasources: {
		db: { url },
	},
})
