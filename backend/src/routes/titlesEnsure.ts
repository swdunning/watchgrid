// backend/src/routes/titlesEnsure.ts
import { Router } from "express"
import { prisma } from "../prisma"
import { requireAuth } from "../auth/authMiddleware"
import axios from "axios"
import { cacheGet, cacheSet } from "../services/cacheService"

const router = Router()

const BASE_URL = "https://api.watchmode.com/v1"
const API_KEY = process.env.WATCHMODE_API_KEY

function requireKey() {
	if (!API_KEY) throw new Error("WATCHMODE_API_KEY missing in backend/.env")
}

function normalizeTypeLabel(t?: string | null) {
	const s = String(t ?? "").toLowerCase()
	if (s.includes("tv")) return "tv_series"
	if (s.includes("movie")) return "movie"
	return s || "movie"
}

function extractYear(details: any): number | null {
	// Watchmode details often has year or release_date.
	const y = (typeof details?.year === "number" ? details.year : null) ?? (typeof details?.release_year === "number" ? details.release_year : null)

	if (y) return y

	const rd = String(details?.release_date ?? "")
	const m = rd.match(/^(\d{4})/)
	return m ? Number(m[1]) : null
}

function extractRuntime(details: any): number | null {
	const rm = (typeof details?.runtime_minutes === "number" ? details.runtime_minutes : null) ?? (typeof details?.runtime === "number" ? details.runtime : null)
	return rm ?? null
}

function extractSeasons(details: any): number | null {
	const s = (typeof details?.number_of_seasons === "number" ? details.number_of_seasons : null) ?? (typeof details?.seasons === "number" ? details.seasons : null)
	return s ?? null
}

function extractDescription(details: any): string | null {
	const d = details?.plot_overview ?? details?.overview ?? details?.description ?? null
	const s = d ? String(d).trim() : ""
	return s ? s : null
}

// Simple in-process lock so repeated modal opens don’t stampede
const inflight = new Map<number, Promise<any>>()

async function fetchWatchmodeDetails(watchmodeTitleId: number) {
	requireKey()

	const cacheKey = `wm:titleDetails:${watchmodeTitleId}`
	const cached = await cacheGet<any>(cacheKey)
	if (cached) return cached

	const url = `${BASE_URL}/title/${watchmodeTitleId}/details/`
	const res = await axios.get(url, {
		params: { apiKey: API_KEY },
		timeout: 15000,
	})

	const data = res.data ?? null
	// Cache 7 days (tune later)
	await cacheSet(cacheKey, data, 7 * 24 * 60 * 60)
	return data
}

async function ensureMetadataFromWatchmode(titleId: number) {
	// lock per-title
	if (inflight.has(titleId)) return inflight.get(titleId)!

	const p = (async () => {
		const existing = await prisma.title.findUnique({
			where: { watchmodeTitleId: titleId },
			select: {
				watchmodeTitleId: true,
				metaStatus: true,
				lastFetchedAt: true,
				year: true,
				runtimeMinutes: true,
				seasons: true,
				description: true,
			},
		})

		if (!existing) return null

		// If we already have the useful fields, don’t refetch
		const hasAnyUseful = !!existing.year || !!existing.runtimeMinutes || !!existing.seasons || !!(existing.description && existing.description.length > 0)

		// Cooldown/staleness policy:
		// - If we have any useful fields and fetched < 7 days ago, skip
		// - If ERROR and fetched < 2 hours ago, skip (avoid hammering bad ids)
		const now = Date.now()
		const last = existing.lastFetchedAt ? existing.lastFetchedAt.getTime() : 0

		if (hasAnyUseful && last && now - last < 7 * 24 * 60 * 60 * 1000) {
			return existing
		}

		if (existing.metaStatus === "ERROR" && last && now - last < 2 * 60 * 60 * 1000) {
			return existing
		}

		try {
			const details = await fetchWatchmodeDetails(titleId)

			const year = extractYear(details)
			const runtimeMinutes = extractRuntime(details)
			const seasons = extractSeasons(details)
			const description = extractDescription(details)

			const updated = await prisma.title.update({
				where: { watchmodeTitleId: titleId },
				data: {
					year,
					runtimeMinutes,
					seasons,
					description,
					metaStatus: "OK",
					lastFetchedAt: new Date(),
				},
			})

			return updated
		} catch (e: any) {
			await prisma.title.update({
				where: { watchmodeTitleId: titleId },
				data: {
					metaStatus: "ERROR",
					lastFetchedAt: new Date(),
				},
			})
			return null
		} finally {
			inflight.delete(titleId)
		}
	})()

	inflight.set(titleId, p)
	return p
}

/**
 * POST /api/titles/ensure
 * Body: { watchmodeTitleId, title, type, poster }
 * - upserts Title basics
 * - ensures metadata (cached)
 * - returns the Title row
 */
router.post("/titles/ensure", requireAuth, async (req, res) => {
	try {
		const watchmodeTitleId = Number(req.body?.watchmodeTitleId)
		const title = String(req.body?.title ?? "").trim()
		const typeRaw = String(req.body?.type ?? "").trim()
		const poster = req.body?.poster ? String(req.body.poster) : null

		if (!Number.isFinite(watchmodeTitleId) || watchmodeTitleId <= 0) {
			return res.status(400).json({ error: "Invalid watchmodeTitleId" })
		}
		if (!title) return res.status(400).json({ error: "Missing title" })

		const type = normalizeTypeLabel(typeRaw)

		// 1) Ensure Title row exists (basics)
		await prisma.title.upsert({
			where: { watchmodeTitleId },
			create: {
				watchmodeTitleId,
				title,
				type,
				poster,
				metaStatus: "PENDING",
			},
			update: {
				title,
				type,
				poster,
			},
		})

		// 2) Ensure metadata (cached + cooldown)
		await ensureMetadataFromWatchmode(watchmodeTitleId)

		// 3) Return latest
		const out = await prisma.title.findUnique({ where: { watchmodeTitleId } })
		return res.json(out)
	} catch (e: any) {
		console.error("[POST /api/titles/ensure] failed:", e?.message ?? e)
		return res.status(500).json({ error: "Server error" })
	}
})

export default router
