import { prisma } from "../prisma"
import { watchmodeGetTitleDetails } from "../services/watchmodeService"

const STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

export async function ensureMetadata(watchmodeTitleId: number) {
	const existing = await prisma.title.findUnique({
		where: { watchmodeTitleId },
	})

	if (!existing) return

	const now = Date.now()

	const isFresh = existing.metaStatus === "OK" && existing.lastFetchedAt && now - new Date(existing.lastFetchedAt).getTime() < STALE_AFTER_MS

	if (isFresh) return

	// Prevent concurrent duplicate enrichments
	if (existing.metaStatus === "PENDING") return

	try {
		// Mark as PENDING
		await prisma.title.update({
			where: { watchmodeTitleId },
			data: { metaStatus: "PENDING" },
		})

		const data = await watchmodeGetTitleDetails(watchmodeTitleId)

		if (!data) {
			await prisma.title.update({
				where: { watchmodeTitleId },
				data: { metaStatus: "ERROR" },
			})
			return
		}

		await prisma.title.update({
			where: { watchmodeTitleId },
			data: {
				year: data.year ?? null,
				runtimeMinutes: data.runtime_minutes ?? null,
				seasons: data.number_of_seasons ?? null,
				description: data.plot_overview ?? null,
				metaStatus: "OK",
				lastFetchedAt: new Date(),
			},
		})
	} catch (e) {
		await prisma.title.update({
			where: { watchmodeTitleId },
			data: { metaStatus: "ERROR" },
		})
	}
}
