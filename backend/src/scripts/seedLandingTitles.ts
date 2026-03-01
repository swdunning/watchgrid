import axios from "axios"
import { prisma } from "../prisma"

const TMDB_KEY = process.env.TMDB_API_KEY!
const TMDB_BASE = "https://api.themoviedb.org/3"

const titlesToSeed = [
	{ query: "The Bear", type: "tv", provider: "HULU" },
	{ query: "Beauty", type: "tv", provider: "HULU" },
	{ query: "Will Trent", type: "tv", provider: "HULU" },
	{ query: "Predator Badlands", type: "movie", provider: "HULU" },
	{ query: "The Astronaut", type: "movie", provider: "HULU" },
	{ query: "Stranger Things", type: "tv", provider: "NETFLIX" },
	{ query: "The Lincoln Lawyer", type: "tv", provider: "NETFLIX" },
	{ query: "Reacher", type: "tv", provider: "PRIME" },
	{ query: "Dune", type: "movie", provider: "MAX" },
	{ query: "The Boys", type: "tv", provider: "PRIME" },
	{ query: "Andor", type: "tv", provider: "DISNEY" },
	{ query: "Severance", type: "tv", provider: "APPLETV" },
	{ query: "The Night Agent", type: "tv", provider: "NETFLIX" },
	{ query: "Yellowstone", type: "tv", provider: "PARAMOUNT" },
	{ query: "Scream 7", type: "movie", provider: "APPLETV" },
	{ query: "The Pitt", type: "tv", provider: "MAX" },
	{ query: "Greenland 2", type: "movie", provider: "NETFLIX" },
	{ query: "Scrubs", type: "tv", provider: "HULU" },
	{ query: "Steal", type: "tv", provider: "Prime" },
	{ query: "Trap House", type: "movie", provider: "NETFLIX" },
	{ query: "Shrinking", type: "tv", provider: "APPLETV" },
	{ query: "The Wrecking Crew", type: "movie", provider: "Prime" },
	{ query: "NCIS", type: "tv", provider: "HULU" },
	{ query: "His & Hers", type: "tv", provider: "NETFLIX" },
	{ query: "The Hunting Party", type: "movie", provider: "NETFLIX" },
	{ query: "Black Rabbit", type: "tv", provider: "NETFLIX" },
	{ query: "Seinfeld", type: "tv", provider: "NETFLIX" },
	{ query: "One Battle After Another", type: "movie", provider: "MAX" },
	{ query: "Foundation", type: "tv", provider: "APPLETV" },
	{ query: "The Rip", type: "movie", provider: "NETFLIX" },
	{ query: "F1", type: "movie", provider: "APPLETV" },
	{ query: "A Knight of the Seven Kingdoms", type: "tv", provider: "MAX" },
	{ query: "Severance", type: "tv", provider: "APPLETV" },
	{ query: "Tulsa Kings", type: "tv", provider: "Paramount" },
	{ query: "John Wick", type: "movie", provider: "MAX" },
	{ query: "Game of Thrones", type: "tv", provider: "MAX" },
	{ query: "Hijack", type: "tv", provider: "APPLETV" },
	{ query: "Fallout", type: "tv", provider: "Prime" },
	{ query: "The 'Burbs", type: "tv", provider: "Peacock" },
	{ query: "Shelter", type: "movie", provider: "Prime" },
	{ query: "Nobody 2", type: "tv", provider: "Prime" },
	{ query: "Ted Lasso", type: "tv", provider: "APPLETV" },
	{ query: "Paradise", type: "tv", provider: "Prime" },
	{ query: "Mercy", type: "movie", provider: "Prime" },
	{ query: "Snowfall", type: "tv", provider: "HULU" },
	{ query: "Pluribus", type: "tv", provider: "APPLETV" },
	{ query: "Weapons", type: "movie", provider: "MAX" },
	{ query: "Cross", type: "tv", provider: "Prime" },
	{ query: "Now You See Me", type: "movie", provider: "Prime" },
	{ query: "Family Guy", type: "tv", provider: "HULU" },
	{ query: "Fountain of Youth", type: "movie", provider: "APPLETV" },
	{ query: "Landman", type: "tv", provider: "Paramount" },
	{ query: "The Rookie", type: "tv", provider: "HULU" },
	{ query: "The Lost Bus", type: "movie", provider: "APPLETV" },
]

async function fetchPoster(query: string, type: "movie" | "tv") {
	const url = `${TMDB_BASE}/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}`

	const res = await axios.get(url)
	const result = res.data.results?.[0]

	if (!result?.poster_path) return null

	return {
		title: result.title || result.name,
		posterUrl: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
	}
}

async function main() {
	await prisma.landingTitle.deleteMany({})

	for (const t of titlesToSeed) {
		const poster = await fetchPoster(t.query, t.type as any)

		if (!poster) continue

		await prisma.landingTitle.create({
			data: {
				title: poster.title,
				posterUrl: poster.posterUrl,
				provider: t.provider,
				type: t.type,
			},
		})

		console.log(`Seeded: ${poster.title}`)
	}

	console.log("Landing titles seeded.")
}

main()
	.catch(console.error)
	.finally(() => prisma.$disconnect())
