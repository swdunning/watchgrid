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
const GENRES_PAGE_SIZE = 3
const DBG = process.env.WG_DEBUG_CACHE === "1"
const GLOBAL_TTL_SECONDS = 24 * 60 * 60

type GenreOption = {
	id: number
	name: string
}

const refreshInFlight = new Map<string, Promise<void>>()
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

function computePayloadTtlSeconds(payload: any, rateLimitedNow: boolean, staleGlobalUsed: boolean) {
	if (staleGlobalUsed) return 30
	const hasEmptyNonListRow = (payload?.rows || []).some((r: any) => r.kind !== "my_list" && (r.items?.length ?? 0) === 0)
	return rateLimitedNow && hasEmptyNonListRow ? 30 : 600
}

async function swrGlobalRow(args: {
	provider: ProviderKey
	kind: "new" | "genre"
	mode: string
	fetch: () => Promise<{ ok: boolean; rateLimited: boolean; titles: any[] }>
}): Promise<{ items: any[]; rateLimited: boolean; staleUsed: boolean }> {
	const cached = await getGlobalRow(args.provider, args.kind, args.mode)
	const hasItems = (cached?.items?.length ?? 0) > 0

	if (hasItems) {
		const staleUsed = !cached!.isFresh

		if (staleUsed) {
			const refreshKey = `${args.kind}:${args.provider}:${args.mode}:US`
			fireAndForgetRefresh(refreshKey, async () => {
				if (DBG) console.log(`[GRC-SWR] refresh start key=${refreshKey}`)

				const res = await args.fetch()
				const items = await buildItems(args.provider, res.titles)

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

	const fetchKey = `${args.kind}:${args.provider}:${args.mode}:US`.toUpperCase()

	if (!fetchInFlight.has(fetchKey)) {
		const p = (async () => {
			const res = await args.fetch()
			const items = await buildItems(args.provider, res.titles)

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

	await fetchInFlight.get(fetchKey)

	const after = await getGlobalRow(args.provider, args.kind, args.mode)
	return {
		items: (after?.items as any[]) ?? [],
		rateLimited: after?.status === "RATE_LIMITED" || false,
		staleUsed: false,
	}
}

async function getNewOnItems(provider: ProviderKey, typesForMode?: "movie" | "tv_series") {
	const now = new Date()
	const yearAgo = new Date(now)
	yearAgo.setFullYear(now.getFullYear() - 1)

	const mode = modeSuffixForTypes(typesForMode)

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

async function getGenreItemsGlobal(provider: ProviderKey, genreId: number, typesForMode?: "movie" | "tv_series") {
	const suffix = modeSuffixForTypes(typesForMode)
	const mode = `g${genreId}:${suffix}`

	const exact = await swrGlobalRow({
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

	if ((exact.items?.length ?? 0) > 0) return exact

	if (suffix !== "all") {
		const allMode = `g${genreId}:all`
		const all = await swrGlobalRow({
			provider,
			kind: "genre",
			mode: allMode,
			fetch: async () => {
				const res = await watchmodeListTitlesResult({
					provider,
					sortBy: "popularity_desc",
					limit: LIMIT,
					page: 1,
					genreIds: [genreId],
				})
				return { ok: res.ok, rateLimited: res.rateLimited, titles: res.titles }
			},
		})

		const filtered =
			suffix === "tv"
				? (all.items || []).filter((it: any) => String(it.type).toLowerCase().includes("tv"))
				: (all.items || []).filter((it: any) => String(it.type).toLowerCase().includes("movie"))

		return {
			items: filtered.slice(0, LIMIT),
			rateLimited: all.rateLimited,
			staleUsed: all.staleUsed,
		}
	}

	return exact
}

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

function genreNameById(genres: { id: number; name: string }[], id: number) {
	return genres.find((g) => g.id === id)?.name ?? null
}

async function getAvailableGenresForProvider(provider: ProviderKey, typesForMode?: "movie" | "tv_series"): Promise<GenreOption[]> {
	const modeKey = modeSuffixForTypes(typesForMode)
	const cacheKey = `providerGenreOptions:${provider}:${modeKey}`

	const cached = await cacheGet<GenreOption[]>(cacheKey)
	if (cached) return cached

	const genres = await watchmodeGetGenres()
	const sorted = [...(genres || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)))

	const available = await asyncPool(2, sorted, async (g) => {
		const gr = await getGenreItemsGlobal(provider, g.id, typesForMode)
		return (gr.items?.length ?? 0) > 0 ? { id: g.id, name: g.name } : null
	})

	const filtered = available.filter(Boolean) as GenreOption[]
	await cacheSet(cacheKey, filtered, 24 * 60 * 60)

	return filtered
}

router.get("/provider/:provider/genre-options", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const provider = normalizeProvider(req.params.provider)
	if (!provider) return res.status(400).json({ error: "Invalid provider" })

	const mode = normalizeMode(req.query.mode)
	const hasProvider = await prisma.userProvider.findFirst({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Not authorized" })

	const typesForMode: "movie" | "tv_series" | undefined = mode === "shows" ? "tv_series" : mode === "movies" ? "movie" : undefined

	const genres = await getAvailableGenresForProvider(provider, typesForMode)

	return res.json({
		provider,
		label: labelFor(provider),
		mode,
		genres,
	})
})

router.get("/provider/:provider/rows", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const provider = normalizeProvider(req.params.provider)
	if (!provider) return res.status(400).json({ error: "Invalid provider" })

	const mode = normalizeMode(req.query.mode)
	const genreIdRaw = String(req.query.genreId ?? "all")
	const genreId = genreIdRaw === "all" ? null : Number(genreIdRaw)

	const hasProvider = await prisma.userProvider.findFirst({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Not authorized" })

	const agg = await prisma.savedItem.aggregate({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
		_count: { _all: true },
		_max: { createdAt: true },
	})

	const maxTs = agg._max.createdAt ? String(agg._max.createdAt.getTime()) : "0"
	const listSig = `${agg._count._all}:${maxTs}`

	const payloadCacheKey = `rows:${userId}:${provider}:${mode}:g=${genreIdRaw}:ls=${listSig}`
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

	const rows: any[] = [
		{
			key: "my_list",
			kind: "my_list",
			title: `My List • ${labelFor(provider)}`,
			page: 1,
			canLoadMore: false,
			items: myListItems,
		},
	]

	let rateLimitedNow = watchmodeWasRateLimitedRecently()
	let staleGlobalUsed = false

	if (genreId && Number.isFinite(genreId)) {
		const availableGenres = await getAvailableGenresForProvider(provider, typesForMode)
		const isAvailable = availableGenres.some((g) => g.id === genreId)

		if (!isAvailable) {
			const payload = {
				provider,
				label: labelFor(provider),
				mode,
				genreId,
				rateLimited: watchmodeWasRateLimitedRecently(),
				rows: [rows[0]],
			}

			await cacheSet(payloadCacheKey, payload, 600)
			return res.json(payload)
		}

		const genreName = availableGenres.find((g) => g.id === genreId)?.name ?? genreNameById(await watchmodeGetGenres(), genreId)
		const genreSuffix = genreName ? ` - ${genreName}` : ""

		if (mode === "shows") {
			const gTv = await getGenreItemsGlobal(provider, genreId, "tv_series")
			rateLimitedNow = rateLimitedNow || gTv.rateLimited
			staleGlobalUsed = staleGlobalUsed || gTv.staleUsed

			const payload = {
				provider,
				label: labelFor(provider),
				mode,
				genreId,
				rateLimited: watchmodeWasRateLimitedRecently(),
				rows: [
					rows[0],
					{
						key: "genre_tv",
						kind: "genre_tv",
						title: `Most popular TV shows${genreSuffix}`,
						page: 1,
						canLoadMore: (gTv.items || []).length > 0,
						genreId,
						items: gTv.items || [],
					},
				],
			}

			const ttl = computePayloadTtlSeconds(payload, rateLimitedNow, staleGlobalUsed)
			await cacheSet(payloadCacheKey, payload, ttl)
			return res.json(payload)
		}

		if (mode === "movies") {
			const gMv = await getGenreItemsGlobal(provider, genreId, "movie")
			rateLimitedNow = rateLimitedNow || gMv.rateLimited
			staleGlobalUsed = staleGlobalUsed || gMv.staleUsed

			const payload = {
				provider,
				label: labelFor(provider),
				mode,
				genreId,
				rateLimited: watchmodeWasRateLimitedRecently(),
				rows: [
					rows[0],
					{
						key: "genre_movies",
						kind: "genre_movies",
						title: `Most popular Movies${genreSuffix}`,
						page: 1,
						canLoadMore: (gMv.items || []).length > 0,
						genreId,
						items: gMv.items || [],
					},
				],
			}

			const ttl = computePayloadTtlSeconds(payload, rateLimitedNow, staleGlobalUsed)
			await cacheSet(payloadCacheKey, payload, ttl)
			return res.json(payload)
		}

		const gTv = await getGenreItemsGlobal(provider, genreId, "tv_series")
		rateLimitedNow = rateLimitedNow || gTv.rateLimited
		staleGlobalUsed = staleGlobalUsed || gTv.staleUsed

		const gMv = await getGenreItemsGlobal(provider, genreId, "movie")
		rateLimitedNow = rateLimitedNow || gMv.rateLimited
		staleGlobalUsed = staleGlobalUsed || gMv.staleUsed

		const payload = {
			provider,
			label: labelFor(provider),
			mode,
			genreId,
			rateLimited: watchmodeWasRateLimitedRecently(),
			rows: [
				rows[0],
				{
					key: "genre_tv",
					kind: "genre_tv",
					title: `Most popular TV shows${genreSuffix}`,
					page: 1,
					canLoadMore: (gTv.items || []).length > 0,
					genreId,
					items: gTv.items || [],
				},
				{
					key: "genre_movies",
					kind: "genre_movies",
					title: `Most popular movies${genreSuffix}`,
					page: 1,
					canLoadMore: (gMv.items || []).length > 0,
					genreId,
					items: gMv.items || [],
				},
			],
		}

		const ttl = computePayloadTtlSeconds(payload, rateLimitedNow, staleGlobalUsed)
		await cacheSet(payloadCacheKey, payload, ttl)
		return res.json(payload)
	}

	if (mode !== "movies") {
		const tv = await getPopularTvItems(provider)
		rateLimitedNow = rateLimitedNow || tv.rateLimited

		rows.push({
			key: "popular_tv",
			kind: "popular_tv",
			title: `Most Popular TV Shows - ${labelFor(provider)}`,
			page: 1,
			canLoadMore: (tv.items || []).length > 0,
			items: tv.items || [],
		})
	}

	if (mode !== "shows") {
		const mv = await getPopularMovieItems(provider)
		rateLimitedNow = rateLimitedNow || mv.rateLimited

		rows.push({
			key: "popular_movies",
			kind: "popular_movies",
			title: `Most Popular Movies - ${labelFor(provider)}`,
			page: 1,
			canLoadMore: (mv.items || []).length > 0,
			items: mv.items || [],
		})
	}

	const newOn = await getNewOnItems(provider, typesForMode)
	rateLimitedNow = rateLimitedNow || newOn.rateLimited
	staleGlobalUsed = staleGlobalUsed || newOn.staleUsed

	rows.push({
		key: "new",
		kind: "new",
		title: `New on ${labelFor(provider)}`,
		page: 1,
		canLoadMore: (newOn.items || []).length === LIMIT,
		items: newOn.items || [],
	})

	const payload: any = {
		provider,
		label: labelFor(provider),
		mode,
		genreId: null,
		rateLimited: watchmodeWasRateLimitedRecently(),
		rows,
	}

	const ttl = computePayloadTtlSeconds(payload, rateLimitedNow, staleGlobalUsed)
	await cacheSet(payloadCacheKey, payload, ttl)

	return res.json(payload)
})

router.get("/provider/:provider/genres", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const provider = normalizeProvider(req.params.provider)
	if (!provider) return res.status(400).json({ error: "Invalid provider" })

	const mode = normalizeMode(req.query.mode)
	const page = Math.max(1, Number(req.query.page ?? 1))

	const hasProvider = await prisma.userProvider.findFirst({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Not authorized" })

	const genresPayloadKey = `genres:${userId}:${provider}:${mode}:p=${page}`
	const cached = await cacheGet<any>(genresPayloadKey)
	if (cached) {
		return res.json({
			...cached,
			rateLimited: watchmodeWasRateLimitedRecently(),
		})
	}

	const typesForMode: "movie" | "tv_series" | undefined = mode === "shows" ? "tv_series" : mode === "movies" ? "movie" : undefined

	const availableGenres = await getAvailableGenresForProvider(provider, typesForMode)

	const allGenreDefs: { key: string; title: string; id: number }[] = availableGenres.map((g) => ({
		key: `genre_${g.id}`,
		title: `Most popular - ${g.name}`,
		id: g.id,
	}))

	const total = allGenreDefs.length
	const start = (page - 1) * GENRES_PAGE_SIZE
	const end = start + GENRES_PAGE_SIZE
	const slice = allGenreDefs.slice(start, end)

	let rateLimitedNow = watchmodeWasRateLimitedRecently()
	let staleGlobalUsed = false

	const rows = await asyncPool(1, slice, async (g) => {
		const gr = await getGenreItemsGlobal(provider, g.id as number, typesForMode)
		rateLimitedNow = rateLimitedNow || gr.rateLimited
		staleGlobalUsed = staleGlobalUsed || gr.staleUsed

		return {
			key: `genre_${String(g.id)}`,
			kind: "genre",
			title: g.title,
			page: 1,
			genreId: g.id,
			canLoadMore: (gr.items || []).length > 0,
			items: gr.items || [],
		}
	})

	const payload: any = {
		provider,
		label: labelFor(provider),
		mode,
		page,
		pageSize: GENRES_PAGE_SIZE,
		total,
		canLoadMore: end < total,
		rows,
		rateLimited: watchmodeWasRateLimitedRecently(),
	}

	const ttl = computePayloadTtlSeconds(payload, rateLimitedNow, staleGlobalUsed)
	await cacheSet(genresPayloadKey, payload, ttl)

	return res.json(payload)
})

router.get("/provider/:provider/row", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const provider = normalizeProvider(req.params.provider)
	if (!provider) return res.status(400).json({ error: "Invalid provider" })

	const kind = String(req.query.kind || "")
	const mode = normalizeMode(req.query.mode)
	const genreIdRaw = req.query.genreId ? Number(req.query.genreId) : null

	const hasProvider = await prisma.userProvider.findFirst({
		where: { userId, provider: { equals: provider, mode: "insensitive" } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Not authorized" })

	const typesForMode: "movie" | "tv_series" | undefined = mode === "shows" ? "tv_series" : mode === "movies" ? "movie" : undefined

	if (kind === "popular_tv") {
		const tv = await getPopularTvItems(provider)
		return res.json({
			row: {
				key: "popular_tv",
				kind: "popular_tv",
				title: `Most Popular TV Shows - ${labelFor(provider)}`,
				page: 1,
				canLoadMore: (tv.items || []).length > 0,
				items: tv.items || [],
			},
			rateLimited: tv.rateLimited || watchmodeWasRateLimitedRecently(),
		})
	}

	if (kind === "popular_movies") {
		const mv = await getPopularMovieItems(provider)
		return res.json({
			row: {
				key: "popular_movies",
				kind: "popular_movies",
				title: `Most Popular Movies - ${labelFor(provider)}`,
				page: 1,
				canLoadMore: (mv.items || []).length > 0,
				items: mv.items || [],
			},
			rateLimited: mv.rateLimited || watchmodeWasRateLimitedRecently(),
		})
	}

	if (kind === "new") {
		const newOn = await getNewOnItems(provider, typesForMode)
		return res.json({
			row: {
				key: "new",
				kind: "new",
				title: `New on ${labelFor(provider)}`,
				page: 1,
				canLoadMore: (newOn.items || []).length === LIMIT,
				items: newOn.items || [],
			},
			rateLimited: newOn.rateLimited || watchmodeWasRateLimitedRecently(),
		})
	}

	if (kind === "genre") {
		if (!genreIdRaw || !Number.isFinite(genreIdRaw)) return res.status(400).json({ error: "Missing genreId" })

		const gr = await getGenreItemsGlobal(provider, genreIdRaw, typesForMode)
		const availableGenres = await getAvailableGenresForProvider(provider, typesForMode)
		const genreName = availableGenres.find((g) => g.id === genreIdRaw)?.name ?? genreNameById(await watchmodeGetGenres(), genreIdRaw)

		return res.json({
			row: {
				key: `genre_${String(genreIdRaw)}`,
				kind: "genre",
				title: `Most popular - ${genreName ?? "Genre"}`,
				page: 1,
				genreId: genreIdRaw,
				canLoadMore: (gr.items || []).length > 0,
				items: gr.items || [],
			},
			rateLimited: gr.rateLimited || watchmodeWasRateLimitedRecently(),
		})
	}

	if (kind === "genre_tv") {
		if (!genreIdRaw || !Number.isFinite(genreIdRaw)) return res.status(400).json({ error: "Missing genreId" })

		const gr = await getGenreItemsGlobal(provider, genreIdRaw, "tv_series")
		const genreName = genreNameById(await watchmodeGetGenres(), genreIdRaw)
		const genreSuffix = genreName ? ` - ${genreName}` : ""

		return res.json({
			row: {
				key: "genre_tv",
				kind: "genre_tv",
				title: `Most popular TV shows${genreSuffix}`,
				page: 1,
				genreId: genreIdRaw,
				canLoadMore: (gr.items || []).length > 0,
				items: gr.items || [],
			},
			rateLimited: gr.rateLimited || watchmodeWasRateLimitedRecently(),
		})
	}

	if (kind === "genre_movies") {
		if (!genreIdRaw || !Number.isFinite(genreIdRaw)) return res.status(400).json({ error: "Missing genreId" })

		const gr = await getGenreItemsGlobal(provider, genreIdRaw, "movie")
		const genreName = genreNameById(await watchmodeGetGenres(), genreIdRaw)
		const genreSuffix = genreName ? ` - ${genreName}` : ""

		return res.json({
			row: {
				key: "genre_movies",
				kind: "genre_movies",
				title: `Most popular movies${genreSuffix}`,
				page: 1,
				genreId: genreIdRaw,
				canLoadMore: (gr.items || []).length > 0,
				items: gr.items || [],
			},
			rateLimited: gr.rateLimited || watchmodeWasRateLimitedRecently(),
		})
	}

	return res.status(400).json({ error: "Invalid kind" })
})

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

console.log("[providerRows] routes registered")
export default router
