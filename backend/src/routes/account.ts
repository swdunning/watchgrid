import { Router } from "express"
import bcrypt from "bcryptjs"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import { normalizeProviderKey } from "../types"

const router = Router()

/**
 * GET /api/account
 * Returns email + providers.
 */
router.get("/account", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { id: true, email: true },
	})

	const providers = await prisma.userProvider.findMany({
		where: { userId },
		select: { provider: true },
	})

	res.json({
		user: {
			id: user?.id,
			email: user?.email,
			providers: providers.map((p) => p.provider),
		},
	})
})

/**
 * PUT /api/account
 * body: { email?: string, currentPassword?: string, newPassword?: string }
 * - Changing password requires currentPassword.
 */
router.put("/account", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const { email, currentPassword, newPassword } = req.body || {}

	const user = await prisma.user.findUnique({ where: { id: userId } })
	if (!user) return res.status(404).json({ error: "User not found" })

	// Update email if provided
	if (email && typeof email === "string") {
		const trimmed = email.trim().toLowerCase()
		if (!trimmed.includes("@")) return res.status(400).json({ error: "Invalid email" })

		const exists = await prisma.user.findUnique({ where: { email: trimmed } })
		if (exists && exists.id !== userId) return res.status(409).json({ error: "Email already in use" })

		await prisma.user.update({ where: { id: userId }, data: { email: trimmed } })
	}

	// Update password if requested
	if (newPassword) {
		if (!currentPassword || typeof currentPassword !== "string") {
			return res.status(400).json({ error: "Current password required" })
		}
		const ok = await bcrypt.compare(currentPassword, user.password)
		if (!ok) return res.status(401).json({ error: "Invalid current password" })

		if (typeof newPassword !== "string" || newPassword.length < 8) {
			return res.status(400).json({ error: "New password must be at least 8 characters" })
		}

		const hashed = await bcrypt.hash(newPassword, 10)
		await prisma.user.update({ where: { id: userId }, data: { password: hashed } })
	}

	return res.json({ ok: true })
})

/**
 * PUT /api/account/providers
 * body: { providers: string[] }
 * Replaces the user's provider list.
 */
router.put("/account/providers", requireAuth, async (req, res) => {
	const userId = (req as any).userId as string

	const raw = Array.isArray(req.body?.providers) ? req.body.providers : []
	const providers = raw.map((p: string) => normalizeProviderKey(p)).filter(Boolean) as string[]

	if (providers.length === 0) return res.status(400).json({ error: "Select at least one provider" })

	await prisma.$transaction([
		prisma.userProvider.deleteMany({ where: { userId } }),
		prisma.userProvider.createMany({
			data: providers.map((p) => ({ userId, provider: p })),
		}),
	])

	return res.json({ ok: true, providers })
})

export default router
