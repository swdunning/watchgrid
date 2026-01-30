import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { PROVIDERS, type ProviderKey, labelFor } from "../types"
import { cacheGet, cacheSet } from "../services/cacheService"
import { watchmodeGetGenres, watchmodeListTitles, watchmodeWasRateLimitedRecently } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"

const router = Router()
const LIMIT = 18

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

	// ✅ Provider rows payload cache (10 minutes) — keyed by listSig so My List stays fresh
	const payloadCacheKey = `rows:${userId}:${provider}:${mode}:g=${genreIdRaw}:ig=${includeGenres ? "1" : "0"}:ls=${listSig}`
	const cached = await cacheGet<any>(payloadCacheKey)
	if (cached) {
		return res.json({
			...cached,
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

	// If specific genre selected -> 3 rows
	if (genreId && Number.isFinite(genreId)) {
		const tv = await watchmodeListTitles({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page: 1,
			types: "tv_series",
			genreIds: [genreId],
		})

		const movies = await watchmodeListTitles({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page: 1,
			types: "movie",
			genreIds: [genreId],
		})

		const payload = {
			provider,
			label: labelFor(provider),
			mode,
			genreId,
			includeGenres: false,
			rateLimited: watchmodeWasRateLimitedRecently(),
			rows: [
				{ key: "my_list", kind: "my_list", title: `My List • ${labelFor(provider)}`, page: 1, canLoadMore: false, items: myListItems },
				{ key: "genre_tv", kind: "genre_tv", title: "Most popular TV shows (USA)", page: 1, canLoadMore: (tv || []).length === LIMIT, genreId, items: await buildItems(provider, tv) },
				{
					key: "genre_movies",
					kind: "genre_movies",
					title: "Most popular movies (USA)",
					page: 1,
					canLoadMore: (movies || []).length === LIMIT,
					genreId,
					items: await buildItems(provider, movies),
				},
			],
		}

		await cacheSet(payloadCacheKey, payload, 600)
		return res.json(payload)
	}

	const typesForMode: "movie" | "tv_series" | undefined = mode === "shows" ? "tv_series" : mode === "movies" ? "movie" : undefined

	const now = new Date()
	const yearAgo = new Date(now)
	yearAgo.setFullYear(now.getFullYear() - 1)

	const rows: any[] = []

	rows.push({
		key: "my_list",
		kind: "my_list",
		title: `My List • ${labelFor(provider)}`,
		page: 1,
		canLoadMore: false,
		items: myListItems,
	})

	if (mode !== "movies") {
		const tvPopular = await watchmodeListTitles({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page: 1,
			types: "tv_series",
		})

		rows.push({
			key: "popular_tv",
			kind: "popular_tv",
			title: "Most popular TV shows (USA)",
			page: 1,
			canLoadMore: (tvPopular || []).length === LIMIT,
			items: await buildItems(provider, tvPopular),
		})
	}

	if (mode !== "shows") {
		const moviePopular = await watchmodeListTitles({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page: 1,
			types: "movie",
		})

		rows.push({
			key: "popular_movies",
			kind: "popular_movies",
			title: "Most popular movies (USA)",
			page: 1,
			canLoadMore: (moviePopular || []).length === LIMIT,
			items: await buildItems(provider, moviePopular),
		})
	}

	const newOn = await watchmodeListTitles({
		provider,
		sortBy: "release_date_desc",
		limit: LIMIT,
		page: 1,
		releaseDateStart: fmt(yearAgo),
		releaseDateEnd: fmt(now),
		...(typesForMode ? { types: typesForMode } : {}),
	})

	rows.push({
		key: "new",
		kind: "new",
		title: "New on this service",
		page: 1,
		canLoadMore: (newOn || []).length === LIMIT,
		items: await buildItems(provider, newOn),
	})

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

		const genreRows = await asyncPool(2, genreDefs, async (g) => {
			const titles = await watchmodeListTitles({
				provider,
				sortBy: "popularity_desc",
				limit: LIMIT,
				page: 1,
				genreIds: [g.id as number],
				...(typesForMode ? { types: typesForMode } : {}),
			})

			return {
				key: g.key,
				kind: "genre",
				genreId: g.id,
				title: g.title,
				page: 1,
				canLoadMore: (titles || []).length === LIMIT,
				items: await buildItems(provider, titles),
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

	await cacheSet(payloadCacheKey, payload, 600)
	return res.json(payload)
})

/**
 * Load more for a single row
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

	let titles: any[] = []

	if (kind === "popular_tv") {
		titles = await watchmodeListTitles({ provider, sortBy: "popularity_desc", limit: LIMIT, page, types: "tv_series" })
	} else if (kind === "popular_movies") {
		titles = await watchmodeListTitles({ provider, sortBy: "popularity_desc", limit: LIMIT, page, types: "movie" })
	} else if (kind === "new") {
		titles = await watchmodeListTitles({
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
		titles = await watchmodeListTitles({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page,
			genreIds: [genreIdRaw],
			...(typesForMode ? { types: typesForMode } : {}),
		})
	} else if (kind === "genre_tv") {
		if (!genreIdRaw || !Number.isFinite(genreIdRaw)) return res.status(400).json({ error: "Missing genreId" })
		titles = await watchmodeListTitles({
			provider,
			sortBy: "popularity_desc",
			limit: LIMIT,
			page,
			genreIds: [genreIdRaw],
			types: "tv_series",
		})
	} else if (kind === "genre_movies") {
		if (!genreIdRaw || !Number.isFinite(genreIdRaw)) return res.status(400).json({ error: "Missing genreId" })
		titles = await watchmodeListTitles({
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

	const items = await buildItems(provider, titles)
	const canLoadMore = (titles || []).length === LIMIT

	return res.json({
		page,
		canLoadMore,
		items,
	})
})

export default router
