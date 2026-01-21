import { Router } from "express"
import { requireAuth } from "../auth/authMiddleware"
import { watchmodeGetGenres } from "../services/watchmodeService"

const router = Router()

/**
 * GET /api/genres
 * Returns Watchmode genres list (cached).
 */
router.get("/genres", requireAuth, async (_req, res) => {
	const genres = await watchmodeGetGenres()
	res.json({ genres })
})

export default router
