import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { type ProviderKey, labelFor } from "../types"
import { watchmodeListTitles } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"

const router = Router()

router.get("/home", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const userProviders = await prisma.userProvider.findMany({ where: { userId } })
	const providers = userProviders.map((p) => p.provider) as ProviderKey[]

	const saved = await prisma.savedItem.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
	})

	// Group saved items per provider
	const rows: Record<string, any> = {}
	for (const p of providers) {
		rows[p] = { provider: p, label: labelFor(p), savedItems: [], popularItems: [] as any[] }
	}
	for (const it of saved) {
		if (rows[it.provider]) rows[it.provider].savedItems.push(it)
	}

	// If provider row is empty, load Popular fallback (cached via watchmodeListTitles)
	await Promise.all(
		providers.map(async (p) => {
			if (rows[p].savedItems.length > 0) return

			const popular = await watchmodeListTitles({ provider: p, sortBy: "popularity_desc", limit: 18 })
			const withPosters = await Promise.all(
				popular.slice(0, 18).map(async (t: any) => ({
					watchmodeTitleId: t.id,
					title: t.name ?? t.title ?? "Untitled",
					type: t.type ?? "unknown",
					poster: await tmdbPosterUrl(t.name ?? t.title ?? ""),
					provider: p,
				})),
			)
			rows[p].popularItems = withPosters
		}),
	)

	res.json({
		providers,
		rows: Object.values(rows),
	})
})

export default router
