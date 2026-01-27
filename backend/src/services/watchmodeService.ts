import axios, { AxiosError } from "axios"
import { cacheGet, cacheSet } from "./cacheService"
import { PROVIDERS, type ProviderKey, labelFor } from "../types"

const BASE_URL = "https://api.watchmode.com/v1"
const API_KEY = process.env.WATCHMODE_API_KEY

function requireKey() {
	if (!API_KEY) throw new Error("WATCHMODE_API_KEY missing in backend/.env")
}

export type WatchmodeSource = {
	id: number
	name: string
	type: string
	region?: string
	logo_100px?: string
	logo_50px?: string
}

export type WatchmodeGenre = {
	id: number
	name: string
}

// --- Retry helper (handles 429 + transient errors) ---
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function getStatus(err: any): number | undefined {
	return (err as AxiosError)?.response?.status
}

function getRetryAfterMs(err: any): number | null {
	const raw = (err as AxiosError)?.response?.headers?.["retry-after"]
	const sec = Number(raw)
	if (Number.isFinite(sec) && sec > 0) return sec * 1000
	return null
}

async function axiosGetWithRetry<T>(url: string, config: any, attempts = 3): Promise<T> {
	let lastErr: any

	for (let i = 0; i < attempts; i++) {
		try {
			const res = await axios.get<T>(url, config)
			return res.data
		} catch (e: any) {
			lastErr = e
			const status = getStatus(e)

			const shouldRetry = status === 429 || status === 502 || status === 503 || status === 504 || e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT"

			if (!shouldRetry || i === attempts - 1) break

			const retryAfterMs = getRetryAfterMs(e)
			const backoffMs = retryAfterMs ?? 500 * Math.pow(2, i) // 500, 1000, 2000
			console.warn(`[watchmode] retry ${i + 1}/${attempts} status=${status} wait=${backoffMs}ms`)
			await sleep(backoffMs)
		}
	}

	throw lastErr
}

export async function watchmodeGetAllSources(): Promise<WatchmodeSource[]> {
	requireKey()

	const cacheKey = `wm:sources:all`
	const cached = await cacheGet<WatchmodeSource[]>(cacheKey)
	if (cached) return cached

	try {
		const data = await axiosGetWithRetry<WatchmodeSource[]>(`${BASE_URL}/sources/`, {
			params: { apiKey: API_KEY },
			timeout: 15000,
		})

		const sources: WatchmodeSource[] = data ?? []
		await cacheSet(cacheKey, sources, 24 * 60 * 60) // 24h
		return sources
	} catch (e: any) {
		// If we had cache we already returned it; here we just fail upward
		console.error("[watchmodeGetAllSources] failed:", getStatus(e) ?? e?.message ?? e)
		throw e
	}
}

export async function watchmodeGetGenres(): Promise<WatchmodeGenre[]> {
	requireKey()

	const cacheKey = `wm:genres:all`
	const cached = await cacheGet<WatchmodeGenre[]>(cacheKey)
	if (cached) return cached

	try {
		const data = await axiosGetWithRetry<WatchmodeGenre[]>(`${BASE_URL}/genres/`, {
			params: { apiKey: API_KEY },
			timeout: 15000,
		})

		const genres: WatchmodeGenre[] = data ?? []
		await cacheSet(cacheKey, genres, 7 * 24 * 60 * 60) // 7 days
		return genres
	} catch (e: any) {
		console.error("[watchmodeGetGenres] failed:", getStatus(e) ?? e?.message ?? e)
		throw e
	}
}

/**
 * Return sourceId + logo for a provider (NETFLIX/HULU/etc)
 */
export async function watchmodeResolveProviderMeta(provider: ProviderKey): Promise<{
	provider: ProviderKey
	label: string
	sourceId: number | null
	logoUrl: string | null
}> {
	const cacheKey = `wm:providerMeta:${provider}`
	const cached = await cacheGet<any>(cacheKey)
	if (cached) return cached

	const sources = await watchmodeGetAllSources()
	const def = PROVIDERS.find((p) => p.key === provider)
	if (!def) {
		const fallback = { provider, label: labelFor(provider), sourceId: null, logoUrl: null }
		await cacheSet(cacheKey, fallback, 7 * 24 * 60 * 60)
		return fallback
	}

	const match = sources.find((s) => def.watchmodeNames.some((n) => s.name.toLowerCase().includes(n.toLowerCase())))

	const meta = {
		provider,
		label: labelFor(provider),
		sourceId: match?.id ?? null,
		logoUrl: (match?.logo_100px ?? match?.logo_50px ?? null) as string | null,
	}

	await cacheSet(cacheKey, meta, 7 * 24 * 60 * 60)
	return meta
}

export async function watchmodeResolveSourceId(provider: ProviderKey): Promise<number | null> {
	const meta = await watchmodeResolveProviderMeta(provider)
	return meta.sourceId
}

export async function watchmodeSearchTitles(query: string) {
	requireKey()

	const cacheKey = `wm:search:${query.toLowerCase()}`
	const cached = await cacheGet<any[]>(cacheKey)
	if (cached) return cached

	try {
		const data = await axiosGetWithRetry<any>(`${BASE_URL}/search/`, {
			params: {
				apiKey: API_KEY,
				search_field: "name",
				search_value: query,
			},
			timeout: 15000,
		})

		const results = data?.title_results ?? []
		await cacheSet(cacheKey, results, 10 * 60) // 10 minutes
		return results
	} catch (e: any) {
		console.warn("[watchmodeSearchTitles] failed:", getStatus(e) ?? e?.message ?? e)
		// Search failures shouldn't crash the app
		return []
	}
}

export async function watchmodeGetSources(titleId: number) {
	requireKey()

	const cacheKey = `wm:titleSources:${titleId}`
	const cached = await cacheGet<any[]>(cacheKey)
	if (cached) return cached

	try {
		const data = await axiosGetWithRetry<any>(`${BASE_URL}/title/${titleId}/sources/`, {
			params: { apiKey: API_KEY },
			timeout: 15000,
		})

		const sources = data ?? []
		await cacheSet(cacheKey, sources, 6 * 60 * 60) // 6 hours
		return sources
	} catch (e: any) {
		console.warn("[watchmodeGetSources] failed:", getStatus(e) ?? e?.message ?? e)
		// Fail closed to empty list (prevents route crashes)
		return []
	}
}

/**
 * /v1/list-titles supports genres filter (single id or comma-separated).
 * We cache each (provider + sort + page + limit + date range + genres).
 * If Watchmode rate-limits us, we retry; if still failing, we return [] (home.ts handles safely).
 */
export async function watchmodeListTitles(args: {
	provider: ProviderKey
	sortBy: "popularity_desc" | "release_date_desc"
	limit?: number
	page?: number
	releaseDateStart?: string // YYYYMMDD
	releaseDateEnd?: string // YYYYMMDD
	genreIds?: number[] // optional
}) {
	requireKey()

	const sourceId = await watchmodeResolveSourceId(args.provider)
	if (!sourceId) return []

	const limit = args.limit ?? 24
	const page = args.page ?? 1
	const genres = args.genreIds && args.genreIds.length ? args.genreIds.join(",") : ""

	const cacheKey = `wm:list:${args.provider}:${args.sortBy}:${page}:${limit}:${args.releaseDateStart ?? ""}:${args.releaseDateEnd ?? ""}:g=${genres}`
	const cached = await cacheGet<any[]>(cacheKey)
	if (cached) return cached

	try {
		const data = await axiosGetWithRetry<any>(`${BASE_URL}/list-titles/`, {
			params: {
				apiKey: API_KEY,
				source_ids: String(sourceId),
				regions: "US",
				sort_by: args.sortBy,
				limit,
				page,
				...(args.releaseDateStart ? { release_date_start: args.releaseDateStart } : {}),
				...(args.releaseDateEnd ? { release_date_end: args.releaseDateEnd } : {}),
				...(genres ? { genres } : {}),
			},
			timeout: 15000,
		})

		const titles = data?.titles ?? data ?? []
		await cacheSet(cacheKey, titles, 60 * 60) // 1 hour
		return titles
	} catch (e: any) {
		const status = getStatus(e)
		console.warn(`[watchmodeListTitles] failed provider=${args.provider} status=${status ?? "?"} msg=${e?.message ?? e}`)
		// Return empty to avoid crashing callers (home.ts will degrade gracefully)
		return []
	}
}
