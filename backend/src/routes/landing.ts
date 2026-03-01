// backend/src/routes/landing.ts
import { Router } from "express"
import { prisma } from "../prisma"

const router = Router()

/**
 * Small helper: Fisher–Yates shuffle.
 * Teaching moment (JS):
 * - We want the collage to look "random" each refresh.
 * - Shuffling an array rearranges its order in-place.
 */
function shuffle<T>(arr: T[]) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[arr[i], arr[j]] = [arr[j], arr[i]]
	}
	return arr
}

/**
 * Small helper: return unique strings while preserving order.
 * Teaching moment:
 * - A Set only stores unique values.
 * - We use it to dedupe poster URLs so we don't repeat the same poster 20x.
 */
function uniqStrings(values: string[]) {
	const seen = new Set<string>()
	const out: string[] = []
	for (const v of values) {
		if (!v) continue
		if (seen.has(v)) continue
		seen.add(v)
		out.push(v)
	}
	return out
}

/**
 * GET /api/landing/demo
 * Returns:
 * - rows for hero mock: popular_netflix / popular_hulu / popular_prime
 * - rows for demo section: all_my_lists / popular_tv / popular_movies
 * - collagePosters: many poster URLs for background collage
 *
 * Teaching moment (Express):
 * - router.get("/path", handler) registers a GET endpoint.
 * - res.json(obj) sends JSON back to the frontend.
 */
router.get("/landing/demo", async (_req, res) => {
	// ✅ Pull more than 60 so the collage has real variety.
	// If you seeded ~50-150 titles, 300 is a good safe ceiling.
	const all = await prisma.landingTitle.findMany({
		orderBy: { id: "desc" },
		take: 300,
	})

	// Normalize DB rows into the shape the frontend already expects.
	const items = all.map((x) => ({
		title: x.title,
		poster: x.posterUrl,
		provider: x.provider ?? null,
		type: x.type ?? null,
	}))

	// Only keep items with posters for anything "visual" (rows + collage).
	// Teaching moment:
	// - filter(Boolean) removes null/undefined/empty string values.
	const withPoster = items.filter((x) => !!x.poster)

	// If the DB is empty or posters are missing, degrade gracefully.
	const takeAny = (n: number) => withPoster.slice(0, n)

	// Buckets so the hero rows look relevant.
	const netflix = withPoster.filter((x) => String(x.provider ?? "").toUpperCase() === "NETFLIX")
	const hulu = withPoster.filter((x) => String(x.provider ?? "").toUpperCase() === "HULU")
	const prime = withPoster.filter((x) => String(x.provider ?? "").toUpperCase() === "PRIME")

	const tv = withPoster.filter((x) =>
		String(x.type ?? "")
			.toLowerCase()
			.includes("tv"),
	)
	const movies = withPoster.filter((x) =>
		String(x.type ?? "")
			.toLowerCase()
			.includes("movie"),
	)

	/**
	 * Collage posters:
	 * - Take poster URLs from ALL seeded titles
	 * - Deduplicate them
	 * - Shuffle them
	 * - Return a larger list so CSS tiling looks rich
	 */
	const posterUrls = withPoster.map((x) => x.poster as string)
	const unique = uniqStrings(posterUrls)
	const collagePosters = shuffle(unique).slice(0, 80)

	return res.json({
		rows: [
			{
				key: "popular_netflix",
				title: "Popular on Netflix",
				items: netflix.length ? netflix.slice(0, 12) : takeAny(12),
			},
			{
				key: "popular_hulu",
				title: "Popular on Hulu",
				items: hulu.length ? hulu.slice(0, 12) : takeAny(12),
			},
			{
				key: "popular_prime",
				title: "Popular on Prime Video",
				items: prime.length ? prime.slice(0, 12) : takeAny(12),
			},

			{ key: "all_my_lists", title: "All My Lists", items: takeAny(10) },
			{ key: "popular_tv", title: "Popular TV Shows", items: tv.length ? tv.slice(0, 10) : takeAny(10) },
			{ key: "popular_movies", title: "Popular Movies", items: movies.length ? movies.slice(0, 10) : takeAny(10) },
		],

		// The frontend uses this for the trakt-style collage wall.
		// Bigger + unique + shuffled = not the same poster repeated.
		collagePosters,
	})
})

export default router
