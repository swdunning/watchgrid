// globalRowCache.ts
import { prisma } from "../prisma"

export type GlobalRowItem = {
	watchmodeTitleId: number
	title: string
	type: string
	poster: string | null
	provider?: string
	watchUrl?: string | null
}

export function buildRowKey(provider: string, kind: string, mode: string, region = "US") {
	return `${kind}:${provider}:${mode}:${region}`.toUpperCase()
}

export async function getGlobalRow(provider: string, kind: string, mode: string, region = "US") {
	const key = buildRowKey(provider, kind, mode, region)
	const row = await prisma.globalRowCache.findUnique({ where: { key } })
	if (!row) return null

	const items: GlobalRowItem[] = JSON.parse(row.itemsJson || "[]")
	const isFresh = row.expiresAt.getTime() > Date.now()

	return {
		key,
		items,
		expiresAt: row.expiresAt,
		fetchedAt: row.fetchedAt,
		status: row.status,
		isFresh,
	}
}

export async function setGlobalRow(args: { provider: string; kind: string; mode: string; items: GlobalRowItem[]; ttlSeconds: number; status?: "OK" | "ERROR" | "RATE_LIMITED"; region?: string }) {
	const DBG = process.env.WG_DEBUG_CACHE === "1"
	const region = args.region ?? "US"
	const key = buildRowKey(args.provider, args.kind, args.mode, region)
	const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000)

	if (DBG) {
		console.log(`[GRC] SET key=${key} items=${(args.items ?? []).length} status=${args.status ?? "OK"} ttl=${args.ttlSeconds}s`)
	}

	await prisma.globalRowCache.upsert({
		where: { key },
		create: {
			key,
			provider: args.provider.toUpperCase(),
			kind: args.kind,
			mode: args.mode,
			region,
			itemsJson: JSON.stringify(args.items ?? []),
			status: (args.status ?? "OK") as any,
			fetchedAt: new Date(),
			expiresAt,
		},
		update: {
			itemsJson: JSON.stringify(args.items ?? []),
			status: (args.status ?? "OK") as any,
			fetchedAt: new Date(),
			expiresAt,
		},
	})

	return key
}
