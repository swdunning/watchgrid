import axios from "axios"
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

export async function watchmodeGetAllSources(): Promise<WatchmodeSource[]> {
	requireKey()

	const cacheKey = `wm:sources:all`
	const cached = await cacheGet<WatchmodeSource[]>(cacheKey)
	if (cached) return cached

	const res = await axios.get(`${BASE_URL}/sources/`, {
		params: { apiKey: API_KEY },
		timeout: 15000,
	})

	const data: WatchmodeSource[] = res.data ?? []
	await cacheSet(cacheKey, data, 24 * 60 * 60) // 24h
	return data
}

export async function watchmodeGetGenres(): Promise<WatchmodeGenre[]> {
	requireKey()

	const cacheKey = `wm:genres:all`
	const cached = await cacheGet<WatchmodeGenre[]>(cacheKey)
	if (cached) return cached

	const res = await axios.get(`${BASE_URL}/genres/`, {
		params: { apiKey: API_KEY },
		timeout: 15000,
	})

	const data: WatchmodeGenre[] = res.data ?? []
	await cacheSet(cacheKey, data, 7 * 24 * 60 * 60) // 7 days
	return data
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

	const res = await axios.get(`${BASE_URL}/search/`, {
		params: {
			apiKey: API_KEY,
			search_field: "name",
			search_value: query,
		},
		timeout: 15000,
	})

	const results = res.data?.title_results ?? []
	await cacheSet(cacheKey, results, 10 * 60) // 10 minutes
	return results
}

export async function watchmodeGetSources(titleId: number) {
	requireKey()

	const cacheKey = `wm:titleSources:${titleId}`
	const cached = await cacheGet<any[]>(cacheKey)
	if (cached) return cached

	const res = await axios.get(`${BASE_URL}/title/${titleId}/sources/`, {
		params: { apiKey: API_KEY },
		timeout: 15000,
	})

	const data = res.data ?? []
	await cacheSet(cacheKey, data, 6 * 60 * 60) // 6 hours
	return data
}

/**
 * /v1/list-titles supports genres filter (single id or comma-separated). :contentReference[oaicite:2]{index=2}
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

	const res = await axios.get(`${BASE_URL}/list-titles/`, {
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

	const titles = res.data?.titles ?? res.data ?? []
	await cacheSet(cacheKey, titles, 60 * 60) // 1 hour
	return titles
}
