import axios from "axios"
import { cacheGet, cacheSet } from "./cacheService"
import { PROVIDERS, type ProviderKey } from "../types"

const BASE_URL = "https://api.watchmode.com/v1"
const API_KEY = process.env.WATCHMODE_API_KEY

function requireKey() {
	if (!API_KEY) throw new Error("WATCHMODE_API_KEY missing in backend/.env")
}

export type WatchmodeSource = {
	id: number
	name: string
	type: string // sub, rent, buy, free, tve, etc.
	region?: string
	logo_100px?: string
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
	// Cache for 24h
	await cacheSet(cacheKey, data, 24 * 60 * 60)
	return data
}

/**
 * Map our ProviderKey (NETFLIX/HULU/etc) -> best Watchmode source_id
 * Uses cached /sources and matches by provider watchmodeNames.
 */
export async function watchmodeResolveSourceId(provider: ProviderKey): Promise<number | null> {
	const cacheKey = `wm:sourceId:${provider}`
	const cached = await cacheGet<number>(cacheKey)
	if (cached) return cached

	const sources = await watchmodeGetAllSources()
	const def = PROVIDERS.find((p) => p.key === provider)
	if (!def) return null

	const match = sources.find((s) => def.watchmodeNames.some((n) => s.name.toLowerCase().includes(n.toLowerCase())))
	if (!match) return null

	// Cache for 7 days (source ids rarely change)
	await cacheSet(cacheKey, match.id, 7 * 24 * 60 * 60)
	return match.id
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
 * List titles for a provider using Watchmode list-titles endpoint:
 * /v1/list-titles/ supports source_ids, sort_by, release_date_start/end, page, limit, etc. :contentReference[oaicite:3]{index=3}
 */
export async function watchmodeListTitles(args: {
	provider: ProviderKey
	sortBy: "popularity_desc" | "release_date_desc"
	limit?: number
	page?: number
	releaseDateStart?: string // YYYYMMDD
	releaseDateEnd?: string // YYYYMMDD
}) {
	requireKey()

	const sourceId = await watchmodeResolveSourceId(args.provider)
	if (!sourceId) return []

	const limit = args.limit ?? 24
	const page = args.page ?? 1

	const cacheKey = `wm:list:${args.provider}:${args.sortBy}:${page}:${limit}:${args.releaseDateStart ?? ""}:${args.releaseDateEnd ?? ""}`
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
		},
		timeout: 15000,
	})

	const titles = res.data?.titles ?? res.data ?? []
	await cacheSet(cacheKey, titles, 60 * 60) // 1 hour
	return titles
}
