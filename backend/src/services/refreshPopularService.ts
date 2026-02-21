import { type ProviderKey } from "../types"
import { watchmodeListTitlesResult } from "./watchmodeService"
import { setGlobalRow } from "./globalRowCache"
import { tmdbPosterUrl } from "./tmdbService"

const LIMIT = 18

async function build(provider: ProviderKey, titles: any[]) {
	const slice = (titles || []).slice(0, LIMIT)
	const items = []
	for (const t of slice) {
		items.push({
			watchmodeTitleId: t.id,
			title: t.name ?? t.title ?? "Untitled",
			type: t.type ?? "unknown",
			poster: await tmdbPosterUrl(t.name ?? t.title ?? ""),
			provider,
		})
	}
	return items
}

export async function refreshPopularForProvider(provider: ProviderKey) {
	const tvRes = await watchmodeListTitlesResult({ provider, sortBy: "popularity_desc", limit: LIMIT, page: 1, types: "tv_series" })
	const mvRes = await watchmodeListTitlesResult({ provider, sortBy: "popularity_desc", limit: LIMIT, page: 1, types: "movie" })
	const allRes = await watchmodeListTitlesResult({ provider, sortBy: "popularity_desc", limit: LIMIT, page: 1 })

	const [tvItems, mvItems, allItems] = await Promise.all([build(provider, tvRes.titles), build(provider, mvRes.titles), build(provider, allRes.titles)])

	await setGlobalRow({
		provider,
		kind: "popular",
		mode: "tv",
		items: tvItems,
		ttlSeconds: tvRes.ok && tvItems.length ? 6 * 60 * 60 : 60,
		status: tvRes.ok && tvItems.length ? "OK" : tvRes.rateLimited ? "RATE_LIMITED" : "ERROR",
	})
	await setGlobalRow({
		provider,
		kind: "popular",
		mode: "movie",
		items: mvItems,
		ttlSeconds: mvRes.ok && mvItems.length ? 6 * 60 * 60 : 60,
		status: mvRes.ok && mvItems.length ? "OK" : mvRes.rateLimited ? "RATE_LIMITED" : "ERROR",
	})
	await setGlobalRow({
		provider,
		kind: "popular",
		mode: "all",
		items: allItems,
		ttlSeconds: allRes.ok && allItems.length ? 6 * 60 * 60 : 60,
		status: allRes.ok && allItems.length ? "OK" : allRes.rateLimited ? "RATE_LIMITED" : "ERROR",
	})

	return {
		rateLimited: tvRes.rateLimited || mvRes.rateLimited || allRes.rateLimited,
		counts: { tv: tvItems.length, movie: mvItems.length, all: allItems.length },
	}
}
