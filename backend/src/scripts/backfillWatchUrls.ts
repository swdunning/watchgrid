import { prisma } from "../prisma"
import { watchmodeGetSources, watchmodeResolveSourceId } from "../services/watchmodeService"

async function resolveWatchUrl(provider: string, watchmodeTitleId: number): Promise<string | null> {
	try {
		const sourceId = await watchmodeResolveSourceId(provider as any)
		const sources = await watchmodeGetSources(watchmodeTitleId)

		if (!Array.isArray(sources) || sources.length === 0) return null

		if (sourceId) {
			const match = sources.find((s: any) => Number(s.source_id) === Number(sourceId))
			if (match?.web_url) return String(match.web_url)
		}

		const anyUrl = sources.find((s: any) => s?.web_url)?.web_url
		return anyUrl ? String(anyUrl) : null
	} catch {
		return null
	}
}

async function main() {
	const missing = await prisma.savedItem.findMany({
		where: { OR: [{ watchUrl: null }, { watchUrl: "" }] },
		orderBy: { createdAt: "desc" },
	})

	console.log(`[backfillWatchUrls] Starting. Items missing watchUrl: ${missing.length}`)

	let updated = 0

	for (let i = 0; i < missing.length; i++) {
		const it = missing[i]
		const url = await resolveWatchUrl(it.provider, it.watchmodeTitleId)

		if (url) {
			await prisma.savedItem.update({
				where: { id: it.id },
				data: { watchUrl: url },
			})
			updated++
			console.log(`[backfillWatchUrls] ${i + 1}/${missing.length} updated: ${it.title}`)
		} else {
			console.log(`[backfillWatchUrls] ${i + 1}/${missing.length} no url: ${it.title}`)
		}
	}

	console.log(`[backfillWatchUrls] Done. Updated: ${updated}/${missing.length}`)
}

main()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
