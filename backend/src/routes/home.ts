// home.ts
import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { type ProviderKey, labelFor, normalizeProviderKey } from "../types"
import { watchmodeListTitlesResult, watchmodeWasRateLimitedRecently } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"
import { getGlobalRow, setGlobalRow } from "../services/globalRowCache"

const router = Router()

type RowItem = {
	watchmodeTitleId: number
	title: string
	type: string
	poster: string | null
	watchUrl?: string | null
	provider?: string
}

type HomeRow = {
	provider: ProviderKey
	label: string
	savedItems: RowItem[]
	popularItems: RowItem[]

	// ✅ row-level signal for UI
	popularRateLimited?: boolean
}

const POP_LIMIT = 18

async function asyncPool<T, R>(limit: number, arr: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
	const ret: Promise<R>[] = []
	const executing: Promise<any>[] = []
	for (const item of arr) {
		const p = Promise.resolve().then(() => fn(item))
		ret.push(p)
		if (limit <= arr.length) {
			const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1))
			executing.push(e)
			if (executing.length >= limit) await Promise.race(executing)
		}
	}
	return Promise.all(ret)
}

async function buildPostered(provider: ProviderKey, titles: any[]): Promise<RowItem[]> {
	const slice = (titles || []).slice(0, POP_LIMIT)
	return asyncPool(4, slice, async (t: any) => ({
		watchmodeTitleId: t.id,
		title: t.name ?? t.title ?? "Untitled",
		type: t.type ?? "unknown",
		poster: await tmdbPosterUrl(t.name ?? t.title ?? ""),
		provider,
	}))
}

async function getPopularForProvider(provider: ProviderKey): Promise<{ items: RowItem[]; rateLimited: boolean }> {
	// 1) DB first
	const cached = await getGlobalRow(provider, "popular", "all")
	if (cached?.items?.length) {
		return { items: cached.items as RowItem[], rateLimited: cached.status === "RATE_LIMITED" }
	}

	// 2) If no DB cache, try Watchmode once
	const popularRes = await watchmodeListTitlesResult({
		provider,
		sortBy: "popularity_desc",
		limit: POP_LIMIT,
		page: 1,
	})

	const items = await buildPostered(provider, popularRes.titles)

	// 3) Don’t store empties as OK
	if (!popularRes.ok && items.length === 0) {
		// short “cooldown” record so we don’t spam
		await setGlobalRow({
			provider,
			kind: "popular",
			mode: "all",
			items: [],
			ttlSeconds: 60,
			status: popularRes.rateLimited ? "RATE_LIMITED" : "ERROR",
		})
		return { items: [], rateLimited: popularRes.rateLimited }
	}

	// 4) Store globally for everyone
	await setGlobalRow({
		provider,
		kind: "popular",
		mode: "all",
		items,
		ttlSeconds: 6 * 60 * 60, // 6 hours
		status: "OK",
	})

	return { items, rateLimited: false }
}

router.get("/home", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const userProviders = await prisma.userProvider.findMany({ where: { userId } })
	const providers = userProviders.map((p) => normalizeProviderKey(p.provider)).filter(Boolean) as ProviderKey[]

	const saved = await prisma.savedItem.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
	})

	// Master row = all saved items across providers
	const masterSavedItems: RowItem[] = saved.map((it) => ({
		watchmodeTitleId: it.watchmodeTitleId,
		title: it.title,
		type: it.type,
		poster: it.poster ?? null,
		watchUrl: it.watchUrl ?? null,
		provider: normalizeProviderKey(it.provider) ?? it.provider,
	}))

	// Per-provider rows
	const rows: Record<string, HomeRow> = {}
	for (const p of providers) {
		rows[p] = { provider: p, label: labelFor(p), savedItems: [], popularItems: [], popularRateLimited: false }
	}

	for (const it of saved) {
		const p = normalizeProviderKey(it.provider)
		if (p && rows[p]) {
			rows[p].savedItems.push({
				watchmodeTitleId: it.watchmodeTitleId,
				title: it.title,
				type: it.type,
				poster: it.poster ?? null,
				watchUrl: it.watchUrl ?? null,
				provider: p,
			})
		}
	}

	// preload popular for each provider (cached; concurrency limited)
	await asyncPool(2, providers, async (p) => {
		const pop = await getPopularForProvider(p)
		rows[p].popularItems = pop.items
		rows[p].popularRateLimited = pop.rateLimited
	})

	// ✅ overall signal + which providers were limited (for UI messaging)
	const popularRateLimitedProviders = Object.values(rows)
		.filter((r) => r.popularRateLimited)
		.map((r) => r.provider)

	res.json({
		providers,
		rateLimited: watchmodeWasRateLimitedRecently(),
		popularRateLimitedProviders,
		masterSavedItems,
		rows: Object.values(rows),
	})
})

export default router
