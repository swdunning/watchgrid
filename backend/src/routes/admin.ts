import { Router } from "express"
import { PROVIDERS, type ProviderKey } from "../types"
import { refreshPopularForProvider } from "../services/refreshPopularService"

const router = Router()

router.post("/admin/refresh-popular", async (req, res) => {
	const token = String(req.headers["x-cron-token"] || "")
	if (!process.env.CRON_TOKEN || token !== process.env.CRON_TOKEN) {
		return res.status(403).json({ error: "Forbidden" })
	}

	const providers = PROVIDERS.map((p) => p.key) as ProviderKey[]

	const out: any[] = []
	for (const p of providers) {
		const r = await refreshPopularForProvider(p)
		out.push({ provider: p, ...r })
	}

	res.json({ ok: true, results: out })
})

export default router
