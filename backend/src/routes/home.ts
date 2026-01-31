import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { type ProviderKey, labelFor, normalizeProviderKey } from "../types"
import { watchmodeListTitles, watchmodeWasRateLimitedRecently } from "../services/watchmodeService"
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
}

const POP_LIMIT = 18
const POP_TTL_SECONDS = 10 * 60 // 10 minutes

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

async function getPopularForProvider(provider: ProviderKey): Promise<RowItem[]> {
	const cacheKey = `home:popular:${provider}:v1`
	const cached = await cacheGet<RowItem[]>(cacheKey)
	if (cached) return cached

	const popular = await watchmodeListTitles({
		provider,
		sortBy: "popularity_desc",
		limit: POP_LIMIT,
		page: 1,
	})

	const items = await buildPostered(provider, popular)
	await cacheSet(cacheKey, items, POP_TTL_SECONDS)
	return items
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
		rows[p] = { provider: p, label: labelFor(p), savedItems: [], popularItems: [] }
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
		rows[p].popularItems = await getPopularForProvider(p)
	})

	res.json({
		providers,
		rateLimited: watchmodeWasRateLimitedRecently(),
		masterSavedItems,
		rows: Object.values(rows),
	})
})

export default router
