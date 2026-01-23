import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { watchmodeGetSources, watchmodeSearchTitles, watchmodeResolveSourceId } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"
import { normalizeProviderKey, type ProviderKey, labelFor } from "../types"

const router = Router()

/**
 * GET /api/search?q=... [&provider=NETFLIX]
 * Auth required. Filters results to enabled providers using Watchmode source_id matching (more reliable than name matching).
 */
router.get("/search", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string
	const q = String(req.query.q ?? "").trim()
	if (!q) return res.status(400).json({ error: "Missing query param: q" })

	const providerParam = req.query.provider ? String(req.query.provider) : null
	const forcedProvider = providerParam ? normalizeProviderKey(providerParam) : null

	// User enabled providers
	const userProviders = await prisma.userProvider.findMany({ where: { userId } })
	const enabled = new Set(userProviders.map((p) => p.provider as ProviderKey))

	const activeProviders: ProviderKey[] = forcedProvider ? (enabled.has(forcedProvider) ? [forcedProvider] : []) : Array.from(enabled)

	if (activeProviders.length === 0) return res.status(403).json({ error: "No enabled providers" })

	// Resolve provider -> sourceId (cached)
	const providerSourceIdPairs = await Promise.all(
		activeProviders.map(async (p) => {
			const sourceId = await watchmodeResolveSourceId(p)
			return { provider: p, sourceId }
		}),
	)

	const providerSourceIds = providerSourceIdPairs.filter((x) => typeof x.sourceId === "number" && x.sourceId).map((x) => x.sourceId as number)

	if (providerSourceIds.length === 0) {
		return res.json([]) // can't resolve any provider source ids
	}

	const wmResults = await watchmodeSearchTitles(q)

	const merged = await Promise.all(
		(wmResults || []).slice(0, 18).map(async (item: any) => {
			const sources = await watchmodeGetSources(item.id)
			const poster = await tmdbPosterUrl(item.name)

			// Try match by source_id (most reliable)
			let matchedProvider: ProviderKey | null = null
			let matchedSource: any = null

			for (const pair of providerSourceIdPairs) {
				if (!pair.sourceId) continue
				const found = (sources ?? []).find((s: any) => Number(s.source_id) === Number(pair.sourceId))
				if (found) {
					matchedProvider = pair.provider
					matchedSource = found
					break
				}
			}

			if (!matchedProvider) return null

			return {
				watchmodeTitleId: item.id,
				title: item.name,
				type: item.type,
				poster,
				provider: matchedProvider,
				watchUrl: matchedSource?.web_url ?? null,
				sourceName: matchedSource?.name ?? labelFor(matchedProvider),
				sourceType: matchedSource?.type ?? null,
			}
		}),
	)

	res.json(merged.filter(Boolean))
})

export default router
