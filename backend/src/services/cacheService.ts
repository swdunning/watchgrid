import { prisma } from "../prisma"

export async function cacheGet<T>(key: string): Promise<T | null> {
	const row = await prisma.cacheEntry.findUnique({ where: { key } })
	if (!row) return null
	if (row.expiresAt.getTime() <= Date.now()) return null

	try {
		return JSON.parse(row.valueJson) as T
	} catch {
		return null
	}
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
	await prisma.cacheEntry.upsert({
		where: { key },
		update: { valueJson: JSON.stringify(value), expiresAt },
		create: { key, valueJson: JSON.stringify(value), expiresAt },
	})
}

export async function cacheDelete(key: string): Promise<void> {
	await prisma.cacheEntry.deleteMany({ where: { key } })
}
