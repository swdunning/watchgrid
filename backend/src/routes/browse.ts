import { Router } from "express"
import { requireAuth } from "../auth/authMiddleware"
import { prisma } from "../prisma"
import { normalizeProviderKey, type ProviderKey, labelFor } from "../types"
import { watchmodeListTitles, watchmodeGetSources } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"

const router = Router()

/**
 * GET /api/provider/:provider/browse?tab=popular|new
 * Returns browse-ready posters (not blank screen).
 */
router.get("/provider/:provider/browse", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string
	const provider = normalizeProviderKey(String(req.params.provider || ""))
	if (!provider) return res.status(400).json({ error: "Invalid provider" })

	const hasProvider = await prisma.userProvider.findUnique({
		where: { userId_provider: { userId, provider } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Provider not enabled for user" })

	const tab = String(req.query.tab ?? "popular")
	const now = new Date()
	const yearAgo = new Date(now.getTime())
	yearAgo.setFullYear(now.getFullYear() - 1)

	// YYYYMMDD helper
	const fmt = (d: Date) => {
		const yyyy = d.getFullYear()
		const mm = String(d.getMonth() + 1).padStart(2, "0")
		const dd = String(d.getDate()).padStart(2, "0")
		return `${yyyy}${mm}${dd}`
	}

	const list =
		tab === "new"
			? await watchmodeListTitles({
					provider,
					sortBy: "release_date_desc",
					limit: 24,
					releaseDateStart: fmt(yearAgo),
					releaseDateEnd: fmt(now),
				})
			: await watchmodeListTitles({
					provider,
					sortBy: "popularity_desc",
					limit: 24,
				})

	// Merge poster + best watchUrl for THIS provider
	const merged = await Promise.all(
		list.slice(0, 24).map(async (t: any) => {
			const poster = await tmdbPosterUrl(t.name || t.title || "")
			const sources = await watchmodeGetSources(t.id)
			const matched = (sources ?? []).find((s: any) =>
				String(s.name || "")
					.toLowerCase()
					.includes(labelFor(provider).toLowerCase()),
			)
			return {
				watchmodeTitleId: t.id,
				title: t.name ?? t.title ?? "Untitled",
				type: t.type ?? "unknown",
				poster,
				provider,
				watchUrl: matched?.web_url ?? null,
			}
		}),
	)

	res.json({ provider, label: labelFor(provider), tab, items: merged })
})

export default router
