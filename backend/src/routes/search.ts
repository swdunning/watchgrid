import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { watchmodeGetSources, watchmodeSearchTitles } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"
import { normalizeProviderKey, sourceMatchesProvider, type ProviderKey } from "../types"

const router = Router()

/**
 * Global search for logged-in user, restricted to user providers.
 * Optional: provider filter with &provider=HULU
 */
router.get("/search", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string
	const q = String(req.query.q ?? "").trim()
	if (!q) return res.status(400).json({ error: "Missing query param: q" })

	const providerParam = req.query.provider ? String(req.query.provider) : null
	const forcedProvider = providerParam ? normalizeProviderKey(providerParam) : null

	const userProviders = await prisma.userProvider.findMany({ where: { userId } })
	const enabled = new Set(userProviders.map((p) => p.provider as ProviderKey))

	const activeProviders: ProviderKey[] = forcedProvider ? (enabled.has(forcedProvider) ? [forcedProvider] : []) : Array.from(enabled)

	if (activeProviders.length === 0) return res.status(403).json({ error: "No enabled providers" })

	const wmResults = await watchmodeSearchTitles(q)

	const merged = await Promise.all(
		wmResults.slice(0, 18).map(async (item: any) => {
			const sources = await watchmodeGetSources(item.id)
			const poster = await tmdbPosterUrl(item.name)

			let matchedProvider: ProviderKey | null = null
			let matchedSource: any = null

			for (const p of activeProviders) {
				const found = (sources ?? []).find((s: any) => sourceMatchesProvider(p, String(s.name)))
				if (found) {
					matchedProvider = p
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
				sourceName: matchedSource?.name ?? null,
				sourceType: matchedSource?.type ?? null,
			}
		}),
	)

	res.json(merged.filter(Boolean))
})

export default router
