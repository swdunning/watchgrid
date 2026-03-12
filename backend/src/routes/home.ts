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

const DBG = process.env.WG_DEBUG_CACHE === "1"
const POPULAR_TTL_SECONDS = 24 * 60 * 60 // 24 hours

// Prevent multiple refreshes for the same provider happening at once (in-memory)
// Per-provider dedupe (don’t start multiple refreshes for same provider)
const refreshInFlight = new Map<string, Promise<void>>()

// Global limiter: run only ONE refresh at a time (queue)
let refreshQueue: Promise<void> = Promise.resolve()

// Per-provider cooldown so we don't enqueue repeatedly during dev double-requests
const refreshQueuedAt = new Map<string, number>()
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

function enqueueGlobalRefresh(fn: () => Promise<void>) {
	refreshQueue = refreshQueue
		.then(() => fn())
		.catch((e) => {
			if (DBG) console.warn(`[POPULAR] queued refresh failed`, e)
		})
}

function fireAndForgetRefresh(key: string, fn: () => Promise<void>) {
	const k = key.toUpperCase()

	// If already running for this provider, skip
	if (refreshInFlight.has(k)) {
		if (DBG) console.log(`[POPULAR] refresh already in-flight key=${k} (skip)`)
		return
	}

	// Cooldown to avoid re-enqueue during dev duplicate requests
	const last = refreshQueuedAt.get(k) ?? 0
	if (Date.now() - last < REFRESH_COOLDOWN_MS) {
		if (DBG) console.log(`[POPULAR] refresh cooldown active key=${k} (skip)`)
		return
	}
	refreshQueuedAt.set(k, Date.now())

	// Enqueue globally (only one executes at a time)
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
	// "Has any items at all?" (fresh OR stale)
	const hasItems = (r: any | null) => (r?.items?.length ?? 0) > 0
	const isFresh = (r: any | null) => !!r?.isFresh

	// --- Helper: refresh "all" from Watchmode and write to DB (24h TTL) ---
	// IMPORTANT: If Watchmode fails and returns 0 items, do NOT overwrite existing cache with [].
	const refreshAll = async () => {
		if (DBG) console.log(`[POPULAR] REFRESH(all) provider=${provider} starting...`)

		const popularRes = await watchmodeListTitlesResult({
			provider,
			sortBy: "popularity_desc",
			limit: POP_LIMIT,
			page: 1,
		})

		const items = await buildPostered(provider, popularRes.titles)

		// ✅ Key change: do NOT overwrite cache with empty items on failure
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
			// If we got items, treat as OK; rateLimited status is mainly meaningful when items are empty.
			status: "OK",
		})

		// Also store splits so Provider Page benefits
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

	// --- 1) Try DB "all" first ---
	const cachedAll = await getGlobalRow(provider, "popular", "all")

	// If we have items (fresh OR stale), return immediately
	if (hasItems(cachedAll)) {
		// If stale, refresh in background (don't await)
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

	// --- 2) Fallback: merge TV + Movie caches (what Provider Page writes) ---
	const cachedTv = await getGlobalRow(provider, "popular", "tv")
	const cachedMv = await getGlobalRow(provider, "popular", "movie")

	const tvItems = hasItems(cachedTv) ? (cachedTv!.items as RowItem[]) : []
	const mvItems = hasItems(cachedMv) ? (cachedMv!.items as RowItem[]) : []

	if (tvItems.length || mvItems.length) {
		// Merge/interleave for a mixed row
		const merged: RowItem[] = []
		let i = 0
		while (merged.length < POP_LIMIT && (i < tvItems.length || i < mvItems.length)) {
			if (i < tvItems.length) merged.push(tvItems[i])
			if (merged.length >= POP_LIMIT) break
			if (i < mvItems.length) merged.push(mvItems[i])
			i++
		}

		// ✅ Key change: Don’t upsert popular:all on every request.
		// Only backfill if popular:all is missing OR stale.
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

		// If either cache is stale, refresh in background (refreshAll writes all+splits)
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

	// --- 3) True cold-start: no DB cache at all, so we must call Watchmode and wait ---
	if (DBG) console.log(`[POPULAR] COLD START provider=${provider} -> Watchmode (awaiting)`)

	await refreshAll()

	// After refresh, try DB again
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

		// Do not wipe cache with empty data on failure
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

	// 1) fresh or stale all-cache
	if (hasItems(cachedAll)) {
		if (!isFresh(cachedAll)) {
			fireAndForgetRefresh(`popular:${provider}:all`, refreshAll)
		}

		return {
			items: (cachedAll?.items as RowItem[]) ?? [],
			rateLimited: cachedAll?.status === "RATE_LIMITED",
		}
	}

	// 2) fallback to tv/movie split caches
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

		// Only backfill all-cache if missing/stale
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

	// 3) true cold start:
	// do NOT block Home waiting for Watchmode.
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
		const pop = await getPopularForProviderFast(p)
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
