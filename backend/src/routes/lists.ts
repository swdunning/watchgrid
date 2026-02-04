import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { normalizeProviderKey } from "../types"
import { tmdbGenresForSavedItem } from "../services/tmdbService"

const router = Router()

router.get("/lists", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const items = await prisma.savedItem.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
	})

	const grouped: Record<string, any[]> = {}
	for (const it of items) {
		grouped[it.provider] = grouped[it.provider] ?? []
		grouped[it.provider].push(it)
	}

	res.json({ grouped })
})

router.post("/lists/add", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const provider = normalizeProviderKey(String(req.body?.provider ?? ""))
	const watchmodeTitleId = Number(req.body?.watchmodeTitleId)
	const title = String(req.body?.title ?? "")
	const type = String(req.body?.type ?? "")
	const poster = req.body?.poster ? String(req.body.poster) : null
	const watchUrl = req.body?.watchUrl ? String(req.body.watchUrl) : null

	if (!provider) return res.status(400).json({ error: "Invalid provider" })
	if (!watchmodeTitleId || !title) return res.status(400).json({ error: "Missing title fields" })

	const hasProvider = await prisma.userProvider.findUnique({
		where: { userId_provider: { userId, provider } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Provider not enabled for user" })

	// NEW: genres persisted with status + attempted timestamp
	let genres: string[] = []
	let genresStatus: "PENDING" | "OK" | "NONE" | "ERROR" = "PENDING"
	const genresAttemptedAt = new Date()

	try {
		genres = await tmdbGenresForSavedItem(title, type)
		genresStatus = genres.length ? "OK" : "NONE"
	} catch (e: any) {
		console.warn("[lists/add] TMDB genre lookup failed:", e?.message ?? e)
		genres = []
		genresStatus = "ERROR"
	}

	const item = await prisma.savedItem.upsert({
		where: {
			userId_provider_watchmodeTitleId: {
				userId,
				provider,
				watchmodeTitleId,
			},
		},
		update: { title, type, poster, watchUrl, genres, genresStatus, genresAttemptedAt },
		create: { userId, provider, watchmodeTitleId, title, type, poster, watchUrl, genres, genresStatus, genresAttemptedAt },
	})

	res.json({ item })
})

router.post("/lists/remove", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const provider = normalizeProviderKey(String(req.body?.provider ?? ""))
	const watchmodeTitleId = Number(req.body?.watchmodeTitleId)

	if (!provider) return res.status(400).json({ error: "Invalid provider" })
	if (!watchmodeTitleId) return res.status(400).json({ error: "Missing watchmodeTitleId" })

	await prisma.savedItem.deleteMany({
		where: { userId, provider, watchmodeTitleId },
	})

	res.json({ ok: true })
})

/**
 * NEW: All My Lists endpoint (Postgres-only)
 * GET /api/lists/all
 */
router.get("/lists/all", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const items = await prisma.savedItem.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
	})

	res.json({ items })
})

router.post("/lists/genres/retry", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string
	const id = String(req.body?.id ?? "")

	if (!id) return res.status(400).json({ error: "Missing id" })

	const item = await prisma.savedItem.findFirst({
		where: { id, userId },
	})
	if (!item) return res.status(404).json({ error: "Not found" })

	const attemptedAt = new Date()

	try {
		const genres = await tmdbGenresForSavedItem(item.title, item.type)
		const status = genres.length ? "OK" : "NONE"

		const updated = await prisma.savedItem.update({
			where: { id: item.id },
			data: { genres, genresStatus: status, genresAttemptedAt: attemptedAt },
		})

		return res.json({ item: updated })
	} catch (e: any) {
		console.warn("[lists/genres/retry] TMDB failed:", e?.message ?? e)

		const updated = await prisma.savedItem.update({
			where: { id: item.id },
			data: { genresStatus: "ERROR", genresAttemptedAt: attemptedAt },
		})

		return res.status(503).json({ error: "Genre retry failed", item: updated })
	}
})

export default router
