import axios from "axios"

const TMDB_KEY = process.env.TMDB_API_KEY
const TMDB_SEARCH = "https://api.themoviedb.org/3/search/multi"
const IMG_BASE = "https://image.tmdb.org/t/p/w500"

function requireKey() {
	if (!TMDB_KEY) throw new Error("TMDB_API_KEY missing in backend/.env")
}

export async function tmdbPosterUrl(title: string): Promise<string | null> {
	requireKey()
	const res = await axios.get(TMDB_SEARCH, {
		params: { api_key: TMDB_KEY, query: title, include_adult: false },
		timeout: 15000,
	})
	const posterPath: string | undefined = res.data?.results?.[0]?.poster_path
	return posterPath ? `${IMG_BASE}${posterPath}` : null
}
