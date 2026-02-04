import axios from "axios"
import { cacheGet, cacheSet } from "./cacheService"

const TMDB_BASE = "https://api.themoviedb.org/3"
const TMDB_KEY = process.env.TMDB_API_KEY
const TMDB_SEARCH = "https://api.themoviedb.org/3/search/multi"
const IMG_BASE = "https://image.tmdb.org/t/p/w500"

function requireKey() {
	if (!TMDB_KEY) throw new Error("TMDB_API_KEY missing in backend/.env")
}

function requireTmdbKey() {
	if (!TMDB_KEY) throw new Error("TMDB_API_KEY missing in backend/.env")
}

async function tmdbGetGenreMap(kind: "movie" | "tv"): Promise<Record<number, string>> {
	requireTmdbKey()

	const cacheKey = `tmdb:genreMap:${kind}`
	const cached = await cacheGet<Record<number, string>>(cacheKey)
	if (cached) return cached

	const res = await axios.get(`${TMDB_BASE}/genre/${kind}/list`, {
		params: { api_key: TMDB_KEY, language: "en-US" },
		timeout: 15000,
	})

	const map: Record<number, string> = {}
	for (const g of res.data?.genres ?? []) map[g.id] = g.name

	await cacheSet(cacheKey, map, 30 * 24 * 60 * 60) // 30 days
	return map
}

async function tmdbSearchGenreIds(title: string, kind: "movie" | "tv"): Promise<number[]> {
	requireTmdbKey()

	const cacheKey = `tmdb:searchGenreIds:${kind}:${title}`.toLowerCase()
	const cached = await cacheGet<number[]>(cacheKey)
	if (cached) return cached

	const res = await axios.get(`${TMDB_BASE}/search/${kind}`, {
		params: {
			api_key: TMDB_KEY,
			query: title,
			include_adult: false,
			language: "en-US",
			page: 1,
		},
		timeout: 15000,
	})

	const first = res.data?.results?.[0]
	const ids: number[] = Array.isArray(first?.genre_ids) ? first.genre_ids : []

	await cacheSet(cacheKey, ids, 7 * 24 * 60 * 60) // 7 days
	return ids
}

/**
 * Returns an array of genre names for a (title,type).
 * type can be "tv" / "movie" / or whatever Watchmode returns.
 */
export async function tmdbGenresForSavedItem(title: string, type: string): Promise<string[]> {
	const t = String(type || "").toLowerCase()
	const kind: "movie" | "tv" = t.includes("tv") ? "tv" : "movie"

	const [ids, map] = await Promise.all([tmdbSearchGenreIds(title, kind), tmdbGetGenreMap(kind)])
	return (ids || []).map((id) => map[id]).filter(Boolean)
}

export async function tmdbPosterUrl(title: string): Promise<string | null> {
	requireKey()
	const res = await axios.get(TMDB_SEARCH, {
		params: { api_key: TMDB_KEY, query: title, include_adult: false },
		timeout: 15000,
	})
	const posterPath: string | undefined = res.data?.results?.[0]?.poster_path
	return posterPath ? `${IMG_BASE}${posterPath}` : null
}
