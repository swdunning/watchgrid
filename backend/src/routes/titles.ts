//titles.ts
import { Router } from "express"

import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
const router = Router()

/**
 * GET /api/titles/:watchmodeTitleId
 * Returns Title metadata from DB (no external calls).
 */
router.get("/titles/:watchmodeTitleId", requireAuth, async (req, res) => {
	try {
		const idRaw = String(req.params.watchmodeTitleId || "").trim()
		const watchmodeTitleId = Number(idRaw)

		if (!Number.isFinite(watchmodeTitleId) || watchmodeTitleId <= 0) {
			return res.status(400).json({ error: "Invalid watchmodeTitleId" })
		}

		const title = await prisma.title.findUnique({
			where: { watchmodeTitleId },
			select: {
				watchmodeTitleId: true,
				title: true,
				type: true,
				poster: true,
				year: true,
				runtimeMinutes: true,
				seasons: true,
				description: true,
				metaStatus: true,
				lastFetchedAt: true,
			},
		})

		if (!title) return res.status(404).json({ error: "Not found" })

		return res.json(title)
	} catch (e: any) {
		console.error("[GET /api/titles/:id] failed:", e?.message ?? e)
		return res.status(500).json({ error: "Server error" })
	}
})

export default router
