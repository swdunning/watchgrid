// home.ts
import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { type ProviderKey, labelFor, normalizeProviderKey } from "../types"
import { watchmodeListTitlesResult, watchmodeWasRateLimitedRecently } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"
import { cacheGet, cacheSet } from "../services/cacheService"

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
const POP_TTL_SECONDS = 10 * 60 // 10 minutes
const POP_COOLDOWN_TTL_SECONDS = 30 // short cache if rate-limited + empty

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

async function getPopularForProvider(provider: ProviderKey): Promise<{
	items: RowItem[]
	rateLimited: boolean
}> {
	// ✅ bump key because payload now stores meta (items + rateLimited)
	const cacheKey = `home:popular:${provider}:v2`
	const cached = await cacheGet<{ items: RowItem[]; rateLimited: boolean }>(cacheKey)
	if (cached) return cached

	const popularRes = await watchmodeListTitlesResult({
		provider,
		sortBy: "popularity_desc",
		limit: POP_LIMIT,
		page: 1,
	})

	const items = await buildPostered(provider, popularRes.titles)
	const rateLimited = !!popularRes.rateLimited

	// ✅ If Watchmode was rate-limited/failed and we got nothing:
	// - do NOT cache empties for 10 minutes
	// - BUT do short-cache for ~30s to avoid hammering on refresh
	if ((rateLimited || !popularRes.ok) && items.length === 0) {
		const payload = { items, rateLimited }
		await cacheSet(cacheKey, payload, POP_COOLDOWN_TTL_SECONDS)
		return payload
	}

	// Normal success path: cache normally
	const payload = { items, rateLimited }
	await cacheSet(cacheKey, payload, POP_TTL_SECONDS)
	return payload
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
