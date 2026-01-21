import { Router } from "express"
import bcrypt from "bcryptjs"
import { prisma } from "../prisma"
import { signToken, verifyToken } from "./jwt"
import { normalizeProviderKey, type ProviderKey } from "../types"

const router = Router()

const COOKIE_OPTIONS = {
	httpOnly: true,
	sameSite: "lax" as const,
	secure: false, // set true in production with HTTPS
	maxAge: 7 * 24 * 60 * 60 * 1000,
}

router.post("/register", async (req, res) => {
	const email = String(req.body?.email ?? "")
		.trim()
		.toLowerCase()
	const password = String(req.body?.password ?? "")
	const providersRaw: string[] = Array.isArray(req.body?.providers) ? req.body.providers : []

	if (!email || !password) return res.status(400).json({ error: "Email and password required" })
	if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" })

	const providerKeys: ProviderKey[] = providersRaw.map((p) => normalizeProviderKey(p)).filter(Boolean) as ProviderKey[]

	if (providerKeys.length === 0) return res.status(400).json({ error: "Select at least one provider" })

	const exists = await prisma.user.findUnique({ where: { email } })
	if (exists) return res.status(409).json({ error: "Email already in use" })

	const passwordHash = await bcrypt.hash(password, 12)

	const user = await prisma.user.create({
		data: {
			email,
			passwordHash,
			providers: {
				create: providerKeys.map((provider) => ({ provider })),
			},
		},
		include: { providers: true },
	})

	const token = signToken({ userId: user.id })
	res.cookie("token", token, COOKIE_OPTIONS)

	res.json({
		user: {
			id: user.id,
			email: user.email,
			providers: user.providers.map((p) => p.provider),
		},
	})
})

router.post("/login", async (req, res) => {
	const email = String(req.body?.email ?? "")
		.trim()
		.toLowerCase()
	const password = String(req.body?.password ?? "")

	if (!email || !password) return res.status(400).json({ error: "Email and password required" })

	const user = await prisma.user.findUnique({ where: { email }, include: { providers: true } })
	if (!user) return res.status(401).json({ error: "Invalid credentials" })

	const ok = await bcrypt.compare(password, user.passwordHash)
	if (!ok) return res.status(401).json({ error: "Invalid credentials" })

	const token = signToken({ userId: user.id })
	res.cookie("token", token, COOKIE_OPTIONS)

	res.json({
		user: {
			id: user.id,
			email: user.email,
			providers: user.providers.map((p) => p.provider),
		},
	})
})

router.post("/logout", async (_req, res) => {
	res.clearCookie("token")
	res.json({ ok: true })
})

router.get("/me", async (req, res) => {
	const token = req.cookies?.token
	if (!token) return res.json({ user: null })

	try {
		const decoded = verifyToken(token)
		const user = await prisma.user.findUnique({
			where: { id: decoded.userId },
			include: { providers: true },
		})
		if (!user) return res.json({ user: null })

		res.json({
			user: {
				id: user.id,
				email: user.email,
				providers: user.providers.map((p) => p.provider),
			},
		})
	} catch {
		res.json({ user: null })
	}
})

export default router
