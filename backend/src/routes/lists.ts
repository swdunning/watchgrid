import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { normalizeProviderKey } from "../types"
import { tmdbGenresForSavedItem } from "../services/tmdbService"
import { watchmodeGetSources, watchmodeResolveSourceId } from "../services/watchmodeService"

const router = Router()

/**
 * Resolve a usable watch URL for this provider/title by calling Watchmode sources.
 * This is ONLY done on add/backfill (not on every page load) to stay rate-limit friendly.
 */
async function resolveWatchUrl(provider: string, watchmodeTitleId: number): Promise<string | null> {
	try {
		const sourceId = await watchmodeResolveSourceId(provider as any)
		const sources = await watchmodeGetSources(watchmodeTitleId)

		if (!Array.isArray(sources) || sources.length === 0) return null

		// Prefer matching by source_id if we have one
		if (sourceId) {
			const match = sources.find((s: any) => Number(s.source_id) === Number(sourceId))
			if (match?.web_url) return String(match.web_url)
		}

		// Fallback: first web_url we can find
		const anyUrl = sources.find((s: any) => s?.web_url)?.web_url
		return anyUrl ? String(anyUrl) : null
	} catch (e: any) {
		// rate-limit or network issues are fine; we just won't have Open until later/backfill
		console.warn("[lists] resolveWatchUrl failed:", e?.message ?? e)
		return null
	}
}

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
	let watchUrl = req.body?.watchUrl ? String(req.body.watchUrl) : null

	if (!provider) return res.status(400).json({ error: "Invalid provider" })
	if (!watchmodeTitleId || !title) return res.status(400).json({ error: "Missing title fields" })

	const hasProvider = await prisma.userProvider.findUnique({
		where: { userId_provider: { userId, provider } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Provider not enabled for user" })

	// If the client didn't send a watchUrl (common for provider/home browse rows),
	// resolve it once here so "Open" works everywhere for saved items.
	if (!watchUrl) {
		watchUrl = await resolveWatchUrl(provider, watchmodeTitleId)
	}

	// Genres persisted with status + attempted timestamp (your v4.4.0 behavior)
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

	// IMPORTANT:
	// - Never overwrite an existing watchUrl with null
	// - Only update watchUrl if we actually have one
	const item = await prisma.savedItem.upsert({
		where: {
			userId_provider_watchmodeTitleId: {
				userId,
				provider,
				watchmodeTitleId,
			},
		},
		update: {
			title,
			type,
			poster,
			...(watchUrl ? { watchUrl } : {}),
			genres,
			genresStatus,
			genresAttemptedAt,
		},
		create: {
			userId,
			provider,
			watchmodeTitleId,
			title,
			type,
			poster,
			watchUrl,
			genres,
			genresStatus,
			genresAttemptedAt,
		},
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
 * GET /api/lists/all (Postgres-only)
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
