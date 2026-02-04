import { prisma } from "../prisma"
import { tmdbGenresForSavedItem } from "../services/tmdbService"

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms))
}

async function main() {
	const batchSize = 25
	const delayMs = 250
	let updated = 0

	const total = await prisma.savedItem.count({
		where: { genresStatus: "PENDING" },
	})

	console.log(`[backfillGenres] Starting. Items pending: ${total}`)

	while (true) {
		const items = await prisma.savedItem.findMany({
			where: { genresStatus: "PENDING" },
			take: batchSize,
			orderBy: { createdAt: "desc" },
		})

		if (!items.length) break

		for (const it of items) {
			const attemptedAt = new Date()

			try {
				const genres = await tmdbGenresForSavedItem(it.title, it.type)
				const status = genres.length ? "OK" : "NONE"

				await prisma.savedItem.update({
					where: { id: it.id },
					data: { genres, genresStatus: status, genresAttemptedAt: attemptedAt },
				})

				updated++
				console.log(`[backfillGenres] ${updated}/${total} :: ${it.title} -> ${status} (${genres.join(", ") || "[]"})`)
			} catch (e: any) {
				await prisma.savedItem.update({
					where: { id: it.id },
					data: { genres: [], genresStatus: "ERROR", genresAttemptedAt: attemptedAt },
				})

				updated++
				console.warn(`[backfillGenres] ${updated}/${total} :: ${it.title} -> ERROR`, e?.message ?? e)
			}

			await sleep(delayMs)
		}
	}

	console.log(`[backfillGenres] Done. Updated: ${updated}`)
}

main()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
