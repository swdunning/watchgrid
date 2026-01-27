import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { type ProviderKey, labelFor } from "../types"
import { watchmodeListTitles } from "../services/watchmodeService"
import { tmdbPosterUrl } from "../services/tmdbService"

const router = Router()

/**
 * Run tasks with a small concurrency limit to reduce Watchmode 429s.
 */
async function asyncPool<T, R>(poolLimit: number, array: T[], iteratorFn: (item: T) => Promise<R>): Promise<R[]> {
	const ret: Promise<R>[] = []
	const executing: Promise<any>[] = []

	for (const item of array) {
		const p = Promise.resolve().then(() => iteratorFn(item))
		ret.push(p)

		if (poolLimit <= array.length) {
			const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1))
			executing.push(e)
			if (executing.length >= poolLimit) {
				await Promise.race(executing)
			}
		}
	}
	return Promise.all(ret)
}

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

	// Only fetch popular fallback for providers where the user has no saved items
	const needPopular = providers.filter((p) => rows[p]?.savedItems?.length === 0)

	// Limit concurrency to reduce rate-limits
	await asyncPool(2, needPopular, async (p) => {
		try {
			const popular = await watchmodeListTitles({ provider: p, sortBy: "popularity_desc", limit: 18 })

			// If rate-limited, watchmodeListTitles returns [] (safe), so this just becomes empty
			const withPosters = await asyncPool(4, popular.slice(0, 18), async (t: any) => ({
				watchmodeTitleId: t.id,
				title: t.name ?? t.title ?? "Untitled",
				type: t.type ?? "unknown",
				poster: await tmdbPosterUrl(t.name ?? t.title ?? ""),
				provider: p,
			}))

			rows[p].popularItems = withPosters
		} catch (e: any) {
			// Never throw—home must still respond
			console.warn(`[home] popular fallback failed for ${p}:`, e?.message ?? e)
			rows[p].popularItems = []
		}
	})

	res.json({
		providers,
		rows: Object.values(rows),
	})
})

export default router
