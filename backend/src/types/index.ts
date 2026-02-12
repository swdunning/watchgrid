//index.ts

export type ProviderKey = "NETFLIX" | "HULU" | "PRIME" | "MAX" | "DISNEY" | "APPLETV" | "PARAMOUNT" | "PEACOCK"

export const PROVIDERS: { key: ProviderKey; label: string; watchmodeNames: string[] }[] = [
	{ key: "NETFLIX", label: "Netflix", watchmodeNames: ["Netflix"] },
	{ key: "HULU", label: "Hulu", watchmodeNames: ["Hulu"] },

	// Prime naming varies in Watchmode sources & title sources
	{ key: "PRIME", label: "Prime Video", watchmodeNames: ["Amazon Prime Video", "Prime Video", "Amazon Video"] },

	// Max naming varies
	{ key: "MAX", label: "Max", watchmodeNames: ["Max", "HBO Max"] },

	// Disney naming varies
	{ key: "DISNEY", label: "Disney+", watchmodeNames: ["Disney+", "Disney Plus"] },

	// Apple TV+ naming varies a LOT
	{ key: "APPLETV", label: "Apple TV+", watchmodeNames: ["AppleTV", "Apple TV+", "Apple TV Plus", "Apple TV"] },

	// Paramount naming varies
	{ key: "PARAMOUNT", label: "Paramount+", watchmodeNames: ["Paramount+", "Paramount Plus"] },

	{ key: "PEACOCK", label: "Peacock", watchmodeNames: ["Peacock"] },
]

export function normalizeProviderKey(raw: string): ProviderKey | null {
	const v = String(raw || "")
		.trim()
		.toUpperCase()
	const keys = PROVIDERS.map((p) => p.key)
	return keys.includes(v as ProviderKey) ? (v as ProviderKey) : null
}

export function labelFor(provider: ProviderKey): string {
	return PROVIDERS.find((p) => p.key === provider)?.label ?? provider
}

/**
 * This is the function your search.ts is calling.
 * It MUST exist + be exported.
 */
export function sourceMatchesProvider(provider: ProviderKey, sourceName: string): boolean {
	const p = PROVIDERS.find((x) => x.key === provider)
	if (!p) return false

	const name = String(sourceName || "").toLowerCase()
	return p.watchmodeNames.some((n) => name.includes(n.toLowerCase()))
}
