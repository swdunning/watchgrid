// providerRows.ts
import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { PROVIDERS, type ProviderKey, labelFor } from "../types"
import { cacheGet, cacheSet } from "../services/cacheService"
import { watchmodeGetGenres, watchmodeListTitlesResult, watchmodeWasRateLimitedRecently } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"
import { getGlobalRow, setGlobalRow } from "../services/globalRowCache"

const router = Router()
const LIMIT = 18

const DBG = process.env.WG_DEBUG_CACHE === "1"
const GLOBAL_TTL_SECONDS = 24 * 60 * 60 // 24h

// Dedupe refresh per key (in-memory, per backend instance)
const refreshInFlight = new Map<string, Promise<void>>()

// Dedupe "cold-start" awaited fetches per (provider/kind/mode)
const fetchInFlight = new Map<string, Promise<void>>()

function fireAndForgetRefresh(key: string, fn: () => Promise<void>) {
	const k = key.toUpperCase()
	if (refreshInFlight.has(k)) {
		if (DBG) console.log(`[GRC-SWR] refresh already in-flight key=${k} (skip)`)
		return
	}
	const p = fn()
		.catch((e) => {
			if (DBG) console.warn(`[GRC-SWR] refresh failed key=${k}`, e)
		})
		.finally(() => refreshInFlight.delete(k))
	refreshInFlight.set(k, p)
}

// Utility: normalize Watchmode "types" into our cache "mode" suffix
function modeSuffixForTypes(types?: "movie" | "tv_series"): "all" | "tv" | "movie" {
	if (types === "tv_series") return "tv"
	if (types === "movie") return "movie"
	return "all"
}

function fmt(d: Date) {
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, "0")
	const day = String(d.getDate()).padStart(2, "0")
	return `${y}${m}${day}`
}

async function asyncPool<T, R>(poolLimit: number, array: T[], iteratorFn: (item: T) => Promise<R>): Promise<R[]> {
	const ret: Promise<R>[] = []
	const executing: Promise<any>[] = []

	for (const item of array) {
		const p = Promise.resolve().then(() => iteratorFn(item))
		ret.push(p)

		if (poolLimit <= array.length) {
			const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1))
			executing.push(e)
			if (executing.length >= poolLimit) await Promise.race(executing)
		}
	}
	return Promise.all(ret)
}

function normalizeMode(raw: any): "all" | "shows" | "movies" {
	const v = String(raw ?? "all").toLowerCase()
	if (v === "shows") return "shows"
	if (v === "movies") return "movies"
	return "all"
}

function normalizeProvider(raw: string): ProviderKey | null {
	const v = String(raw || "")
		.trim()
		.toUpperCase()
	const ok = PROVIDERS.some((p) => p.key === (v as ProviderKey))
	return ok ? (v as ProviderKey) : null
}

function asBool(raw: any): boolean {
	const v = String(raw ?? "").toLowerCase()
	return v === "1" || v === "true" || v === "yes"
}

async function buildItems(provider: ProviderKey, titles: any[]) {
	const slice = (titles || []).slice(0, LIMIT)
	return asyncPool(4, slice, async (t: any) => ({
		watchmodeTitleId: t.id,
		title: t.name ?? t.title ?? "Untitled",
		type: t.type ?? "unknown",
		poster: await tmdbPosterUrl(t.name ?? t.title ?? ""),
		provider,
	}))
}

async function findGenreId(genres: { id: number; name: string }[], names: string[]) {
	const lower = genres.map((g) => ({ ...g, n: g.name.toLowerCase() }))
	for (const n of names) {
		const exact = lower.find((g) => g.n === n.toLowerCase())
		if (exact) return exact.id
	}
	for (const n of names) {
		const partial = lower.find((g) => g.n.includes(n.toLowerCase()))
		if (partial) return partial.id
	}
	return null
}

async function getCuratedGenreIds() {
	const genres = await watchmodeGetGenres()

	const comedyId = await findGenreId(genres, ["Comedy"])
	const dramaId = await findGenreId(genres, ["Drama"])
	const scifiId = await findGenreId(genres, ["Science Fiction", "Sci-Fi", "Fantasy", "Sci-Fi & Fantasy"])
	const actionId = await findGenreId(genres, ["Action", "Action & Adventure"])
	const mysteryId = await findGenreId(genres, ["Mystery", "Mystery & Thriller", "Thriller"])
	const docId = await findGenreId(genres, ["Documentary"])

	return { comedyId, dramaId, scifiId, actionId, mysteryId, docId }
}

/**
 * Cache policy:
 * - Normal payload TTL: 10 minutes
 * - If rate-limited AND any non-my_list row is empty: short TTL (30s) so we retry soon
 * - If we served any STALE global rows (SWR), short TTL (30s) so payload picks up refreshed data soon
 */
function computePayloadTtlSeconds(payload: any, rateLimitedNow: boolean, staleGlobalUsed: boolean) {
	if (staleGlobalUsed) return 30
	const hasEmptyNonListRow = (payload?.rows || []).some((r: any) => r.kind !== "my_list" && (r.items?.length ?? 0) === 0)
	return rateLimitedNow && hasEmptyNonListRow ? 30 : 600
}

/**
 * SWR helper:
 * - If cache has items (fresh OR stale): return immediately.
 * - If stale: refresh in background (deduped).
 * - If missing/empty: fetch once (await), then store.
 * Returns { items, rateLimited, staleUsed }
 */
async function swrGlobalRow(args: {
	provider: ProviderKey
	kind: "new" | "genre"
	mode: string
	fetch: () => Promise<{ ok: boolean; rateLimited: boolean; titles: any[] }>
}): Promise<{ items: any[]; rateLimited: boolean; staleUsed: boolean }> {
	const cached = await getGlobalRow(args.provider, args.kind, args.mode)
	const hasItems = (cached?.items?.length ?? 0) > 0

	// ✅ If cache has items (fresh OR stale): serve immediately.
	if (hasItems) {
		const staleUsed = !cached!.isFresh

		// If stale, refresh async but serve immediately (deduped)
		if (staleUsed) {
			const refreshKey = `${args.kind}:${args.provider}:${args.mode}:US`
			fireAndForgetRefresh(refreshKey, async () => {
				if (DBG) console.log(`[GRC-SWR] refresh start key=${refreshKey}`)

				const res = await args.fetch()
				const items = await buildItems(args.provider, res.titles)

				// ✅ do NOT overwrite good cache with []
				if (!res.ok && items.length === 0) {
					if (DBG) console.log(`[GRC-SWR] refresh failed key=${refreshKey} -> keep existing cache`)
					return
				}

				await setGlobalRow({
					provider: args.provider,
					kind: args.kind,
					mode: args.mode,
					items,
					ttlSeconds: GLOBAL_TTL_SECONDS,
					status: "OK",
				})

				if (DBG) console.log(`[GRC-SWR] refresh done key=${refreshKey} items=${items.length}`)
			})
		}

		return { items: cached!.items as any[], rateLimited: cached!.status === "RATE_LIMITED", staleUsed }
	}

	// ✅ Cold-start path: dedupe awaited fetch per (provider/kind/mode)
	const fetchKey = `${args.kind}:${args.provider}:${args.mode}:US`.toUpperCase()

	if (!fetchInFlight.has(fetchKey)) {
		const p = (async () => {
			const res = await args.fetch()
			const items = await buildItems(args.provider, res.titles)

			// If hard failure and no items, store short cooldown (prevents hammering)
			if (!res.ok && items.length === 0) {
				await setGlobalRow({
					provider: args.provider,
					kind: args.kind,
					mode: args.mode,
					items: [],
					ttlSeconds: 60,
					status: res.rateLimited ? "RATE_LIMITED" : "ERROR",
				})
				return
			}

			await setGlobalRow({
				provider: args.provider,
				kind: args.kind,
				mode: args.mode,
				items,
				ttlSeconds: GLOBAL_TTL_SECONDS,
				status: "OK",
			})
		})()
			.catch((e) => {
				if (DBG) console.warn(`[GRC-SWR] cold-start fetch failed key=${fetchKey}`, e)
			})
			.finally(() => fetchInFlight.delete(fetchKey))

		fetchInFlight.set(fetchKey, p)
	}

	// Everyone awaits the same in-flight fetch
	await fetchInFlight.get(fetchKey)

	// Re-read from DB and return
	const after = await getGlobalRow(args.provider, args.kind, args.mode)
	return {
		items: (after?.items as any[]) ?? [],
		rateLimited: after?.status === "RATE_LIMITED" || false,
		staleUsed: false,
	}
}

/**
 * Global-cached: "New on this service" row
 */
async function getNewOnItems(provider: ProviderKey, typesForMode?: "movie" | "tv_series") {
	const now = new Date()
	const yearAgo = new Date(now)
	yearAgo.setFullYear(now.getFullYear() - 1)

	const mode = modeSuffixForTypes(typesForMode) // all|tv|movie

	return swrGlobalRow({
		provider,
		kind: "new",
		mode,
		fetch: async () => {
			const res = await watchmodeListTitlesResult({
				provider,
				sortBy: "release_date_desc",
				limit: LIMIT,
				page: 1,
				releaseDateStart: fmt(yearAgo),
				releaseDateEnd: fmt(now),
				...(typesForMode ? { types: typesForMode } : {}),
			})
			return { ok: res.ok, rateLimited: res.rateLimited, titles: res.titles }
		},
	})
}

/**
 * Global-cached: Genre row (any genreId)
 * mode: g<id>:all|tv|movie
 */
async function getGenreItemsGlobal(provider: ProviderKey, genreId: number, typesForMode?: "movie" | "tv_series") {
	const suffix = modeSuffixForTypes(typesForMode)
	const mode = `g${genreId}:${suffix}`

	return swrGlobalRow({
		provider,
		kind: "genre",
		mode,
		fetch: async () => {
			const res = await watchmodeListTitlesResult({
				provider,
				sortBy: "popularity_desc",
				limit: LIMIT,
				page: 1,
				genreIds: [genreId],
				...(typesForMode ? { types: typesForMode } : {}),
			})
			return { ok: res.ok, rateLimited: res.rateLimited, titles: res.titles }
		},
	})
}

/**
 * Existing popular helpers (already DB-first globally) — keep as-is
 */
async function getPopularTvItems(provider: ProviderKey) {
	const cached = await getGlobalRow(provider, "popular", "tv")
	if (cached?.items?.length) {
		return { items: cached.items, rateLimited: cached.status === "RATE_LIMITED" }
	}

	const res = await watchmodeListTitlesResult({
		provider,
		sortBy: "popularity_desc",
		limit: LIMIT,
		page: 1,
		types: "tv_series",
	})

	const items = await buildItems(provider, res.titles)

	await setGlobalRow({
		provider,
		kind: "popular",
		mode: "tv",
		items,
		ttlSeconds: res.ok && items.length ? 24 * 60 * 60 : 60,
		status: res.ok && items.length ? "OK" : res.rateLimited ? "RATE_LIMITED" : "ERROR",
	})

	return { items, rateLimited: res.rateLimited }
}

async function getPopularMovieItems(provider: ProviderKey) {
	const cached = await getGlobalRow(provider, "popular", "movie")
	if (cached?.items?.length) {
		return { items: cached.items, rateLimited: cached.status === "RATE_LIMITED" }
	}

	const res = await watchmodeListTitlesResult({
		provider,
		sortBy: "popularity_desc",
		limit: LIMIT,
		page: 1,
		types: "movie",
	})

	const items = await buildItems(provider, res.titles)

	await setGlobalRow({
		provider,
		kind: "popular",
		mode: "movie",
		items,
		ttlSeconds: res.ok && items.length ? 24 * 60 * 60 : 60,
		status: res.ok && items.length ? "OK" : res.rateLimited ? "RATE_LIMITED" : "ERROR",
	})

	return { items, rateLimited: res.rateLimited }
}

/**
 * GET /api/provider/:provider/rows
 * mode=all|shows|movies
 * genreId=all|<number>
 * includeGenres=0|1
 */
router.get("/provider/:provider/rows", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const provider = normalizeProvider(req.params.provider)
	if (!provider) return res.status(400).json({ error: "Invalid provider" })

	const mode = normalizeMode(req.query.mode)
	const genreIdRaw = String(req.query.genreId ?? "all")
	const genreId = genreIdRaw === "all" ? null : Number(genreIdRaw)
	const includeGenres = asBool(req.query.includeGenres)

	const hasProvider = await prisma.userProvider.findFirst({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Not authorized" })

	// ✅ List signature — bust cache whenever user's list for this provider changes
	const agg = await prisma.savedItem.aggregate({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
		_count: { _all: true },
		_max: { createdAt: true },
	})

	const maxTs = agg._max.createdAt ? String(agg._max.createdAt.getTime()) : "0"
	const listSig = `${agg._count._all}:${maxTs}`

	const payloadCacheKey = `rows:${userId}:${provider}:${mode}:g=${genreIdRaw}:ig=${includeGenres ? "1" : "0"}:ls=${listSig}`
	const cachedPayload = await cacheGet<any>(payloadCacheKey)
	if (cachedPayload) {
		return res.json({
			...cachedPayload,
			rateLimited: watchmodeWasRateLimitedRecently(),
		})
	}

	const saved = await prisma.savedItem.findMany({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
		orderBy: { createdAt: "desc" },
	})

	const myListItems = saved.map((s) => ({
		watchmodeTitleId: s.watchmodeTitleId,
		title: s.title,
		type: s.type,
		poster: s.poster ?? null,
		watchUrl: s.watchUrl ?? null,
		provider,
	}))

	const typesForMode: "movie" | "tv_series" | undefined = mode === "shows" ? "tv_series" : mode === "movies" ? "movie" : undefined

	const rows: any[] = []
	rows.push({
		key: "my_list",
		kind: "my_list",
		title: `My List • ${labelFor(provider)}`,
		page: 1,
		canLoadMore: false,
		items: myListItems,
	})

	let rateLimitedNow = watchmodeWasRateLimitedRecently()
	let staleGlobalUsed = false

	// If specific genre selected -> build 3 rows, but now genre rows are global-cached
	if (genreId && Number.isFinite(genreId)) {
		// Genre TV (global-cached)
		const gTv = await getGenreItemsGlobal(provider, genreId, "tv_series")
		rateLimitedNow = rateLimitedNow || gTv.rateLimited
		staleGlobalUsed = staleGlobalUsed || gTv.staleUsed

		// Genre Movies (global-cached)
		const gMv = await getGenreItemsGlobal(provider, genreId, "movie")
		rateLimitedNow = rateLimitedNow || gMv.rateLimited
		staleGlobalUsed = staleGlobalUsed || gMv.staleUsed

		// Popular rows are still global-cached via existing functions (optional to include here)
		const payload = {
			provider,
			label: labelFor(provider),
			mode,
			genreId,
			includeGenres: false,
			rateLimited: watchmodeWasRateLimitedRecently(),
			rows: [
				{
					key: "my_list",
					kind: "my_list",
					title: `My List • ${labelFor(provider)}`,
					page: 1,
					canLoadMore: false,
					items: myListItems,
				},
				{
					key: "genre_tv",
					kind: "genre_tv",
					title: "Most popular TV shows (USA)",
					page: 1,
					canLoadMore: (gTv.items || []).length === LIMIT,
					genreId,
					items: gTv.items || [],
				},
				{
					key: "genre_movies",
					kind: "genre_movies",
					title: "Most popular movies (USA)",
					page: 1,
					canLoadMore: (gMv.items || []).length === LIMIT,
					genreId,
					items: gMv.items || [],
				},
			],
		}

		const ttl = computePayloadTtlSeconds(payload, rateLimitedNow, staleGlobalUsed)
		await cacheSet(payloadCacheKey, payload, ttl)
		return res.json(payload)
	}

	// ✅ DB-first popular TV
	if (mode !== "movies") {
		const tv = await getPopularTvItems(provider)
		rateLimitedNow = rateLimitedNow || tv.rateLimited

		rows.push({
			key: "popular_tv",
			kind: "popular_tv",
			title: "Most popular TV shows (USA)",
			page: 1,
			// ✅ Always allow Load More if we have any items; browse endpoint will decide if more pages exist.
			canLoadMore: (tv.items || []).length > 0,
			items: tv.items || [],
		})
	}

	// ✅ DB-first popular Movies
	if (mode !== "shows") {
		const mv = await getPopularMovieItems(provider)
		rateLimitedNow = rateLimitedNow || mv.rateLimited

		rows.push({
			key: "popular_movies",
			kind: "popular_movies",
			title: "Most popular movies (USA)",
			page: 1,
			// ✅ Always allow Load More if we have any items; browse endpoint will decide if more pages exist.
			canLoadMore: (mv.items || []).length > 0,
			items: mv.items || [],
		})
	}

	// ✅ Global-cached: New on this service (SWR)
	const newOn = await getNewOnItems(provider, typesForMode)
	rateLimitedNow = rateLimitedNow || newOn.rateLimited
	staleGlobalUsed = staleGlobalUsed || newOn.staleUsed

	rows.push({
		key: "new",
		kind: "new",
		title: "New on this service",
		page: 1,
		canLoadMore: (newOn.items || []).length === LIMIT,
		items: newOn.items || [],
	})

	// ✅ Global-cached: Genre rows when includeGenres=1 (SWR)
	if (includeGenres) {
		const { comedyId, dramaId, scifiId, actionId, mysteryId, docId } = await getCuratedGenreIds()

		const genreDefs: { key: string; title: string; id: number | null }[] = [
			{ key: "comedy", title: "Most popular comedies", id: comedyId },
			{ key: "drama", title: "Most popular drama", id: dramaId },
			{ key: "scifi", title: "Most popular Sci-fi/Fantasy", id: scifiId },
			{ key: "action", title: "Most popular action", id: actionId },
			{ key: "mystery", title: "Most popular mysteries", id: mysteryId },
			{ key: "docs", title: "Most popular documentaries", id: docId },
		].filter((g) => !!g.id)

		const genreRows = await asyncPool(1, genreDefs, async (g) => {
			const gr = await getGenreItemsGlobal(provider, g.id as number, typesForMode)
			rateLimitedNow = rateLimitedNow || gr.rateLimited
			staleGlobalUsed = staleGlobalUsed || gr.staleUsed

			return {
				key: g.key,
				kind: "genre",
				genreId: g.id,
				title: g.title,
				page: 1,
				canLoadMore: (gr.items || []).length === LIMIT,
				items: gr.items || [],
			}
		})

		rows.push(...genreRows)
	}

	const payload = {
		provider,
		label: labelFor(provider),
		mode,
		genreId: null,
		includeGenres,
		rateLimited: watchmodeWasRateLimitedRecently(),
		rows,
	}

	const ttl = computePayloadTtlSeconds(payload, rateLimitedNow, staleGlobalUsed)
	await cacheSet(payloadCacheKey, payload, ttl)

	return res.json(payload)
})

/**
 * Load more for a single row
 * (kept as Watchmode live pagination; we can DB-cache later if desired)
 */
router.get("/provider/:provider/browse", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const provider = normalizeProvider(req.params.provider)
	if (!provider) return res.status(400).json({ error: "Invalid provider" })

	const kind = String(req.query.kind || "")
	const mode = normalizeMode(req.query.mode)
	const page = Math.max(1, Number(req.query.page ?? 1))
	const genreIdRaw = req.query.genreId ? Number(req.query.genreId) : null

	const hasProvider = await prisma.userProvider.findFirst({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Not authorized" })

	const typesForMode: "movie" | "tv_series" | undefined = mode === "shows" ? "tv_series" : mode === "movies" ? "movie" : undefined

	const now = new Date()
	const yearAgo = new Date(now)
	yearAgo.setFullYear(now.getFullYear() - 1)

	let result: { titles: any[]; rateLimited: boolean } | null = null

	if (kind === "popular_tv") {
		result = await watchmodeListTitlesResult({ provider, sortBy: "popularity_desc", limit: LIMIT, page, types: "tv_series" })
	} else if (kind === "popular_movies") {
		result = await watchmodeListTitlesResult({ provider, sortBy: "popularity_desc", limit: LIMIT, page, types: "movie" })
	} else if (kind === "new") {
		result = await watchmodeListTitlesResult({
			provider,
			sortBy: "release_date_desc",
			limit: LIMIT,
			page,
			releaseDateStart: fmt(yearAgo),
			releaseDateEnd: fmt(now),
			...(typesForMode ? { types: typesForMode } : {}),
		})
	} else if (kind === "genre") {
		if (!genreIdRaw || !Number.isFinite(genreIdRaw)) return res.status(400).json({ error: "Missing genreId" })
		result = await watchmodeListTitlesResult({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page,
			genreIds: [genreIdRaw],
			...(typesForMode ? { types: typesForMode } : {}),
		})
	} else if (kind === "genre_tv") {
		if (!genreIdRaw || !Number.isFinite(genreIdRaw)) return res.status(400).json({ error: "Missing genreId" })
		result = await watchmodeListTitlesResult({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page,
			genreIds: [genreIdRaw],
			types: "tv_series",
		})
	} else if (kind === "genre_movies") {
		if (!genreIdRaw || !Number.isFinite(genreIdRaw)) return res.status(400).json({ error: "Missing genreId" })
		result = await watchmodeListTitlesResult({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page,
			genreIds: [genreIdRaw],
			types: "movie",
		})
	} else {
		return res.status(400).json({ error: "Invalid kind" })
	}

	const titles = result?.titles ?? []
	const items = await buildItems(provider, titles)
	const canLoadMore = (titles || []).length === LIMIT

	const rateLimitedNow = !!result?.rateLimited || watchmodeWasRateLimitedRecently()

	return res.json({
		page,
		canLoadMore,
		items,
		rateLimited: rateLimitedNow,
	})
})

export default router
