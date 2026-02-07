// backend/src/routes/search.ts
import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { watchmodeGetSources, watchmodeSearchTitles, watchmodeResolveSourceId } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"
import { normalizeProviderKey, type ProviderKey, labelFor } from "../types"
import { cacheGet, cacheSet } from "../services/cacheService"

const router = Router()

/**
 * GET /api/watchurl?provider=NETFLIX&watchmodeTitleId=123
 * - Resolves a deep link (web_url) for a title on a provider without storing every browse-row URL up front.
 * - Uses cache to avoid hammering Watchmode.
 * - If the title is in the user's SavedItem list, also persists watchUrl in DB for next time.
 */
router.get("/watchurl", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const providerRaw = String(req.query.provider ?? "")
	const provider = normalizeProviderKey(providerRaw) as ProviderKey | null
	const watchmodeTitleId = Number(req.query.watchmodeTitleId)

	if (!provider) return res.status(400).json({ error: "Invalid provider" })
	if (!watchmodeTitleId || !Number.isFinite(watchmodeTitleId)) return res.status(400).json({ error: "Invalid watchmodeTitleId" })

	// Cache by provider+title
	const cacheKey = `watchurl:${provider}:${watchmodeTitleId}`
	const cached = await cacheGet<{ watchUrl: string | null }>(cacheKey)
	if (cached) return res.json(cached)

	// Resolve provider -> sourceId (Watchmode)
	const sourceId = await watchmodeResolveSourceId(provider)
	if (!sourceId) {
		const payload = { watchUrl: null }
		await cacheSet(cacheKey, payload, 60 * 60) // 1 hour
		return res.json(payload)
	}

	// Fetch sources for the title, find the provider match
	const sources = await watchmodeGetSources(watchmodeTitleId)
	const matched = (sources ?? []).find((s: any) => Number(s.source_id) === Number(sourceId))

	const watchUrl: string | null = matched?.web_url ?? null

	// Persist to DB *only if* user has it saved (keeps DB clean + useful)
	if (watchUrl) {
		await prisma.savedItem.updateMany({
			where: { userId, provider: { equals: provider, mode: "insensitive" }, watchmodeTitleId },
			data: { watchUrl },
		})
	}

	const payload = { watchUrl }
	await cacheSet(cacheKey, payload, 60 * 60 * 24 * 7) // 7 days
	return res.json(payload)
})

/**
 * GET /api/search?q=... [&provider=NETFLIX]
 * Auth required. Filters results to enabled providers using Watchmode source_id matching.
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

	const activeProviders: ProviderKey[] = forcedProvider ? (enabled.has(forcedProvider as ProviderKey) ? [forcedProvider as ProviderKey] : []) : Array.from(enabled)

	if (activeProviders.length === 0) return res.status(403).json({ error: "No enabled providers" })

	// Resolve provider -> sourceId (cached inside service)
	const providerSourceIdPairs = await Promise.all(activeProviders.map(async (p) => ({ provider: p, sourceId: await watchmodeResolveSourceId(p) })))

	const providerSourceIds = providerSourceIdPairs.filter((x) => typeof x.sourceId === "number" && x.sourceId).map((x) => x.sourceId as number)

	if (providerSourceIds.length === 0) {
		console.warn("[search] No sourceIds resolved for providers:", activeProviders)
		return res.json([])
	}

	const wmResults = await watchmodeSearchTitles(q)

	const merged = await Promise.all(
		(wmResults || []).slice(0, 18).map(async (item: any) => {
			const sources = await watchmodeGetSources(item.id)
			const poster = await tmdbPosterUrl(item.name)

			// Match by source_id
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
