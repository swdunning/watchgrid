import { Router } from "express"
import { requireAuth } from "../auth/authMiddleware"
import { PROVIDERS, type ProviderKey, labelFor } from "../types"
import { watchmodeResolveProviderMeta } from "../services/watchmodeService"

const router = Router()

/**
 * GET /api/meta/providers
 * Returns ALL known providers (not user-specific),
 * with labels + logos (if Watchmode resolves them).
 */
router.get("/meta/providers", requireAuth, async (_req, res) => {
	const all = await Promise.all(
		PROVIDERS.map(async (p) => {
			const meta = await watchmodeResolveProviderMeta(p.key as ProviderKey)
			return {
				provider: p.key,
				label: labelFor(p.key as ProviderKey),
				logoUrl: meta.logoUrl ?? null,
			}
		}),
	)

	res.json({ providers: all })
})

export default router
