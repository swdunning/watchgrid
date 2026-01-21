import { prisma } from "../prisma"
import { cacheSet } from "../services/cacheService"
import { watchmodeGetAllSources, watchmodeGetGenres, watchmodeGetSources, watchmodeListTitles } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"
import { type ProviderKey } from "../types"

async function main() {
	console.log("[refresh] starting…")

	// 1) Refresh sources list + genres (they are cached inside service too, but we force-warm them)
	await watchmodeGetAllSources()
	await watchmodeGetGenres()
	console.log("[refresh] warmed sources + genres")

	// 2) Refresh popular rows per provider for all providers any user has selected
	const providersInUse = await prisma.userProvider.findMany({
		select: { provider: true },
		distinct: ["provider"],
	})
	const providerKeys = providersInUse.map((p) => p.provider) as ProviderKey[]

	for (const p of providerKeys) {
		const popular = await watchmodeListTitles({ provider: p, sortBy: "popularity_desc", limit: 18 })
		// Warm posters (TMDB) and store a prebuilt list into cache for your home fallback
		const built = await Promise.all(
			popular.slice(0, 18).map(async (t: any) => ({
				watchmodeTitleId: t.id,
				title: t.name ?? t.title ?? "Untitled",
				type: t.type ?? "unknown",
				poster: await tmdbPosterUrl(t.name ?? t.title ?? ""),
				provider: p,
			})),
		)

		// Store under a stable key you can optionally read later
		await cacheSet(`wg:popular:${p}`, built, 2 * 60 * 60) // 2 hours
		console.log(`[refresh] warmed popular: ${p}`)
	}

	// 3) Refresh title sources for saved items (deep links)
	const saved = await prisma.savedItem.findMany({ select: { watchmodeTitleId: true } })
	const uniqueIds = Array.from(new Set(saved.map((s) => s.watchmodeTitleId)))

	for (const id of uniqueIds) {
		await watchmodeGetSources(id) // cached in service
	}
	console.log(`[refresh] warmed title sources: ${uniqueIds.length} titles`)

	console.log("[refresh] done ✅")
}

main()
	.catch((e) => {
		console.error("[refresh] failed", e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
