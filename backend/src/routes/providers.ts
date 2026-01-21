import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { normalizeProviderKey } from "../types"

const router = Router()

/**
 * Provider page data (saved items for that provider)
 */
router.get("/provider/:provider", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string
	const provider = normalizeProviderKey(String(req.params.provider || ""))
	if (!provider) return res.status(400).json({ error: "Invalid provider" })

	const hasProvider = await prisma.userProvider.findUnique({
		where: { userId_provider: { userId, provider } },
	})
	if (!hasProvider) return res.status(403).json({ error: "Provider not enabled for user" })

	const items = await prisma.savedItem.findMany({
		where: { userId, provider },
		orderBy: { createdAt: "desc" },
	})

	res.json({ provider, items })
})

export default router
