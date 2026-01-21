export type Provider = { name: string; type: string; url: string }
export type TitleResult = { id: number; title: string; type: string; poster: string | null; providers: Provider[] }

const BASE = "http://localhost:4000"

export async function searchTitles(q: string): Promise<TitleResult[]> {
	const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`)
	if (!res.ok) throw new Error(`Search failed: ${res.status}`)
	return res.json()
}
