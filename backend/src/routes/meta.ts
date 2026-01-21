import { Router } from "express"
import { requireAuth } from "../auth/authMiddleware"
import { prisma } from "../prisma"
import { type ProviderKey, labelFor } from "../types"
import { watchmodeResolveProviderMeta } from "../services/watchmodeService"

const router = Router()

/**
 * GET /api/meta/providers
 * Returns user's providers with label + full-color logoUrl (from Watchmode sources).
 */
router.get("/meta/providers", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const userProviders = await prisma.userProvider.findMany({ where: { userId } })
	const providers = userProviders.map((p) => p.provider) as ProviderKey[]

	const meta = await Promise.all(
		providers.map(async (p) => {
			const m = await watchmodeResolveProviderMeta(p)
			return { provider: p, label: labelFor(p), logoUrl: m.logoUrl }
		}),
	)

	res.json({ providers: meta })
})

export default router
