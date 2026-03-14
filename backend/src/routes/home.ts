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
	popularRateLimited?: boolean
}

const POP_LIMIT = 18
const DBG = process.env.WG_DEBUG_CACHE === "1"
const POPULAR_TTL_SECONDS = 24 * 60 * 60

const refreshInFlight = new Map<string, Promise<void>>()
let refreshQueue: Promise<void> = Promise.resolve()
const refreshQueuedAt = new Map<string, number>()
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000

function enqueueGlobalRefresh(fn: () => Promise<void>) {
	refreshQueue = refreshQueue
		.then(() => fn())
		.catch((e) => {
			if (DBG) console.warn(`[POPULAR] queued refresh failed`, e)
		})
}

function fireAndForgetRefresh(key: string, fn: () => Promise<void>) {
	const k = key.toUpperCase()

	if (refreshInFlight.has(k)) {
		if (DBG) console.log(`[POPULAR] refresh already in-flight key=${k} (skip)`)
		return
	}

	const last = refreshQueuedAt.get(k) ?? 0
	if (Date.now() - last < REFRESH_COOLDOWN_MS) {
		if (DBG) console.log(`[POPULAR] refresh cooldown active key=${k} (skip)`)
		return
	}
	refreshQueuedAt.set(k, Date.now())

	const p = new Promise<void>((resolve) => {
		enqueueGlobalRefresh(async () => {
			try {
				await fn()
			} finally {
				resolve()
			}
		})
	})
		.catch((e) => {
			if (DBG) console.warn(`[POPULAR] refresh failed key=${k}`, e)
		})
		.finally(() => {
			refreshInFlight.delete(k)
		})

	refreshInFlight.set(k, p)
}

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
	const hasItems = (r: any | null) => (r?.items?.length ?? 0) > 0
	const isFresh = (r: any | null) => !!r?.isFresh

	const refreshAll = async () => {
		if (DBG) console.log(`[POPULAR] REFRESH(all) provider=${provider} starting...`)

		const popularRes = await watchmodeListTitlesResult({
			provider,
			sortBy: "popularity_desc",
			limit: POP_LIMIT,
			page: 1,
		})

		const items = await buildPostered(provider, popularRes.titles)

		if (!popularRes.ok && items.length === 0) {
			if (DBG) {
				console.log(`[POPULAR] REFRESH(all) provider=${provider} failed ok=${popularRes.ok} rateLimited=${popularRes.rateLimited} -> keep existing cache`)
			}
			return
		}

		await setGlobalRow({
			provider,
			kind: "popular",
			mode: "all",
			items,
			ttlSeconds: POPULAR_TTL_SECONDS,
			status: "OK",
		})

		const tvItems = items.filter((it) => String(it.type).toLowerCase().includes("tv"))
		const mvItems = items.filter((it) => String(it.type).toLowerCase().includes("movie"))

		if (tvItems.length) {
			await setGlobalRow({
				provider,
				kind: "popular",
				mode: "tv",
				items: tvItems.slice(0, POP_LIMIT),
				ttlSeconds: POPULAR_TTL_SECONDS,
				status: "OK",
			})
		}

		if (mvItems.length) {
			await setGlobalRow({
				provider,
				kind: "popular",
				mode: "movie",
				items: mvItems.slice(0, POP_LIMIT),
				ttlSeconds: POPULAR_TTL_SECONDS,
				status: "OK",
			})
		}

		if (DBG) console.log(`[POPULAR] REFRESH(all) provider=${provider} done items=${items.length}`)
	}

	const cachedAll = await getGlobalRow(provider, "popular", "all")

	if (hasItems(cachedAll)) {
		if (!isFresh(cachedAll)) {
			const refreshKey = `popular:${provider}:all`
			if (DBG) console.log(`[POPULAR] serve STALE(all) provider=${provider} -> async refresh`)
			fireAndForgetRefresh(refreshKey, refreshAll)
		} else {
			if (DBG) console.log(`[POPULAR] serve FRESH(all) provider=${provider}`)
		}

		return {
			items: (cachedAll?.items as RowItem[]) ?? [],
			rateLimited: cachedAll?.status === "RATE_LIMITED",
		}
	}

	const cachedTv = await getGlobalRow(provider, "popular", "tv")
	const cachedMv = await getGlobalRow(provider, "popular", "movie")

	const tvItems = hasItems(cachedTv) ? (cachedTv!.items as RowItem[]) : []
	const mvItems = hasItems(cachedMv) ? (cachedMv!.items as RowItem[]) : []

	if (tvItems.length || mvItems.length) {
		const merged: RowItem[] = []
		let i = 0
		while (merged.length < POP_LIMIT && (i < tvItems.length || i < mvItems.length)) {
			if (i < tvItems.length) merged.push(tvItems[i])
			if (merged.length >= POP_LIMIT) break
			if (i < mvItems.length) merged.push(mvItems[i])
			i++
		}

		if (!cachedAll || !isFresh(cachedAll)) {
			await setGlobalRow({
				provider,
				kind: "popular",
				mode: "all",
				items: merged,
				ttlSeconds: POPULAR_TTL_SECONDS,
				status: "OK",
			})
		}

		if (!isFresh(cachedTv) || !isFresh(cachedMv)) {
			const refreshKey = `popular:${provider}:all`
			if (DBG) console.log(`[POPULAR] serve STALE(tv/movie) provider=${provider} -> async refresh`)
			fireAndForgetRefresh(refreshKey, refreshAll)
		} else {
			if (DBG) console.log(`[POPULAR] serve FRESH(tv/movie) provider=${provider}`)
		}

		const rateLimited = cachedTv?.status === "RATE_LIMITED" || cachedMv?.status === "RATE_LIMITED"
		return { items: merged, rateLimited: !!rateLimited }
	}

	if (DBG) console.log(`[POPULAR] COLD START provider=${provider} -> Watchmode (awaiting)`)

	await refreshAll()

	const after = await getGlobalRow(provider, "popular", "all")
	return {
		items: (after?.items as RowItem[]) ?? [],
		rateLimited: after?.status === "RATE_LIMITED" || false,
	}
}

async function getPopularForProviderFast(provider: ProviderKey): Promise<{ items: RowItem[]; rateLimited: boolean }> {
	const hasItems = (r: any | null) => (r?.items?.length ?? 0) > 0
	const isFresh = (r: any | null) => !!r?.isFresh

	const refreshAll = async () => {
		if (DBG) console.log(`[POPULAR] FAST REFRESH(all) provider=${provider} starting...`)

		const popularRes = await watchmodeListTitlesResult({
			provider,
			sortBy: "popularity_desc",
			limit: POP_LIMIT,
			page: 1,
		})

		const items = await buildPostered(provider, popularRes.titles)

		if (!popularRes.ok && items.length === 0) {
			if (DBG) {
				console.log(`[POPULAR] FAST REFRESH(all) provider=${provider} failed ok=${popularRes.ok} rateLimited=${popularRes.rateLimited} -> keep existing cache`)
			}
			return
		}

		await setGlobalRow({
			provider,
			kind: "popular",
			mode: "all",
			items,
			ttlSeconds: POPULAR_TTL_SECONDS,
			status: "OK",
		})

		const tvItems = items.filter((it) => String(it.type).toLowerCase().includes("tv"))
		const mvItems = items.filter((it) => String(it.type).toLowerCase().includes("movie"))

		if (tvItems.length) {
			await setGlobalRow({
				provider,
				kind: "popular",
				mode: "tv",
				items: tvItems.slice(0, POP_LIMIT),
				ttlSeconds: POPULAR_TTL_SECONDS,
				status: "OK",
			})
		}

		if (mvItems.length) {
			await setGlobalRow({
				provider,
				kind: "popular",
				mode: "movie",
				items: mvItems.slice(0, POP_LIMIT),
				ttlSeconds: POPULAR_TTL_SECONDS,
				status: "OK",
			})
		}

		if (DBG) console.log(`[POPULAR] FAST REFRESH(all) provider=${provider} done items=${items.length}`)
	}

	const cachedAll = await getGlobalRow(provider, "popular", "all")

	if (hasItems(cachedAll)) {
		if (!isFresh(cachedAll)) {
			fireAndForgetRefresh(`popular:${provider}:all`, refreshAll)
		}

		return {
			items: (cachedAll?.items as RowItem[]) ?? [],
			rateLimited: cachedAll?.status === "RATE_LIMITED",
		}
	}

	const cachedTv = await getGlobalRow(provider, "popular", "tv")
	const cachedMv = await getGlobalRow(provider, "popular", "movie")

	const tvItems = hasItems(cachedTv) ? (cachedTv!.items as RowItem[]) : []
	const mvItems = hasItems(cachedMv) ? (cachedMv!.items as RowItem[]) : []

	if (tvItems.length || mvItems.length) {
		const merged: RowItem[] = []
		let i = 0
		while (merged.length < POP_LIMIT && (i < tvItems.length || i < mvItems.length)) {
			if (i < tvItems.length) merged.push(tvItems[i])
			if (merged.length >= POP_LIMIT) break
			if (i < mvItems.length) merged.push(mvItems[i])
			i++
		}

		if (!cachedAll || !isFresh(cachedAll)) {
			await setGlobalRow({
				provider,
				kind: "popular",
				mode: "all",
				items: merged,
				ttlSeconds: POPULAR_TTL_SECONDS,
				status: "OK",
			})
		}

		if (!isFresh(cachedTv) || !isFresh(cachedMv)) {
			fireAndForgetRefresh(`popular:${provider}:all`, refreshAll)
		}

		const rateLimited = cachedTv?.status === "RATE_LIMITED" || cachedMv?.status === "RATE_LIMITED"
		return { items: merged, rateLimited: !!rateLimited }
	}

	if (DBG) console.log(`[POPULAR] FAST COLD START provider=${provider} -> async refresh only`)
	fireAndForgetRefresh(`popular:${provider}:all`, refreshAll)

	return {
		items: [],
		rateLimited: watchmodeWasRateLimitedRecently(),
	}
}

router.get("/home", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const userProviders = await prisma.userProvider.findMany({ where: { userId } })
	const providers = userProviders.map((p) => normalizeProviderKey(p.provider)).filter(Boolean) as ProviderKey[]

	const saved = await prisma.savedItem.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
	})

	const masterSavedItems: RowItem[] = saved.map((it) => ({
		watchmodeTitleId: it.watchmodeTitleId,
		title: it.title,
		type: it.type,
		poster: it.poster ?? null,
		watchUrl: it.watchUrl ?? null,
		provider: normalizeProviderKey(it.provider) ?? it.provider,
	}))

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

	await asyncPool(2, providers, async (p) => {
		const pop = await getPopularForProviderFast(p)
		rows[p].popularItems = pop.items
		rows[p].popularRateLimited = pop.rateLimited
	})

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

router.get("/home/provider/:provider/popular-row", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string
	const provider = normalizeProviderKey(req.params.provider)

	if (!provider) {
		return res.status(400).json({ error: "Invalid provider" })
	}

	const hasProvider = await prisma.userProvider.findFirst({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
	})

	if (!hasProvider) {
		return res.status(403).json({ error: "Not authorized" })
	}

	const pop = await getPopularForProvider(provider)

	res.json({
		provider,
		label: labelFor(provider),
		popularItems: pop.items || [],
		rateLimited: pop.rateLimited || watchmodeWasRateLimitedRecently(),
	})
})

export default router
