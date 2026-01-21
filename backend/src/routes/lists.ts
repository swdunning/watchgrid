import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { normalizeProviderKey, type ProviderKey } from "../types"

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

	const item = await prisma.savedItem.upsert({
		where: {
			userId_provider_watchmodeTitleId: {
				userId,
				provider,
				watchmodeTitleId,
			},
		},
		update: { title, type, poster, watchUrl },
		create: { userId, provider, watchmodeTitleId, title, type, poster, watchUrl },
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

export default router
