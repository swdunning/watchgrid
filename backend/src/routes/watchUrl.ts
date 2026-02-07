import { Router } from "express"
import { requireAuth } from "../auth/authMiddleware"
import { cacheGet, cacheSet } from "../services/cacheService"
import { normalizeProviderKey } from "../types"
import { watchmodeGetSources, watchmodeResolveSourceId } from "../services/watchmodeService"

const router = Router()

/**
 * GET /api/watchurl?provider=NETFLIX&watchmodeTitleId=123
 * Resolves provider-specific web_url via Watchmode sources.
 * Caches result so repeated opens don't hit Watchmode again.
 */
router.get("/watchurl", requireAuth, async (req, res) => {
	const provider = normalizeProviderKey(String(req.query.provider ?? ""))
	const watchmodeTitleId = Number(req.query.watchmodeTitleId)

	if (!provider) return res.status(400).json({ error: "Invalid provider" })
	if (!watchmodeTitleId) return res.status(400).json({ error: "Missing watchmodeTitleId" })

	const cacheKey = `watchurl:${provider}:${watchmodeTitleId}`
	const cached = await cacheGet<{ watchUrl: string | null }>(cacheKey)
	if (cached) return res.json(cached)

	// Resolve provider source_id once (your service likely caches internally too)
	const sourceId = await watchmodeResolveSourceId(provider)
	if (!sourceId) {
		await cacheSet(cacheKey, { watchUrl: null }, 60 * 60) // 1h negative cache
		return res.json({ watchUrl: null })
	}

	const sources = await watchmodeGetSources(watchmodeTitleId)

	const match = (sources ?? []).find((s: any) => Number(s.source_id) === Number(sourceId))
	const watchUrl = match?.web_url ?? null

	// Cache for 7 days (tune if you want)
	await cacheSet(cacheKey, { watchUrl }, 60 * 60 * 24 * 7)

	return res.json({ watchUrl })
})

export default router
