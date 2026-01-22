// backend/src/types/index.ts

export type ProviderKey = "NETFLIX" | "HULU" | "PRIME_VIDEO" | "DISNEY_PLUS" | "HBO_MAX" | "APPLE_TV" | "PARAMOUNT_PLUS" | "PEACOCK"

export type ProviderDef = {
	key: ProviderKey
	label: string
	// strings used to match Watchmode /sources names
	watchmodeNames: string[]
}

export const PROVIDERS: ProviderDef[] = [
	{ key: "NETFLIX", label: "Netflix", watchmodeNames: ["netflix"] },
	{ key: "HULU", label: "Hulu", watchmodeNames: ["hulu"] },
	{ key: "PRIME_VIDEO", label: "Prime Video", watchmodeNames: ["amazon prime", "prime video", "amazon"] },
	// Watchmode source name is often "HBO Max" or "Max"
	{ key: "HBO_MAX", label: "Max", watchmodeNames: ["hbo max", "max", "hbo"] },
	{ key: "APPLE_TV", label: "Apple TV+", watchmodeNames: ["apple tv", "apple tv+", "apple tv plus", "appletv"] },
	{ key: "DISNEY_PLUS", label: "Disney+", watchmodeNames: ["disney+", "disney plus"] },
	{ key: "PARAMOUNT_PLUS", label: "Paramount+", watchmodeNames: ["paramount+", "paramount plus"] },
	{ key: "PEACOCK", label: "Peacock", watchmodeNames: ["peacock"] },
]

const LABELS: Record<ProviderKey, string> = Object.fromEntries(PROVIDERS.map((p) => [p.key, p.label])) as Record<ProviderKey, string>

export function labelFor(key: ProviderKey): string {
	return LABELS[key] ?? key
}

const NORMALIZE: Record<string, ProviderKey> = {
	NETFLIX: "NETFLIX",
	netflix: "NETFLIX",
	Hulu: "HULU",
	hulu: "HULU",
	HULU: "HULU",

	PRIME_VIDEO: "PRIME_VIDEO",
	"prime video": "PRIME_VIDEO",
	primevideo: "PRIME_VIDEO",
	amazon: "PRIME_VIDEO",
	"amazon prime": "PRIME_VIDEO",
	"amazon prime video": "PRIME_VIDEO",

	DISNEY_PLUS: "DISNEY_PLUS",
	"disney+": "DISNEY_PLUS",
	disneyplus: "DISNEY_PLUS",
	"disney plus": "DISNEY_PLUS",

	HBO_MAX: "HBO_MAX",
	"hbo max": "HBO_MAX",
	hbomax: "HBO_MAX",
	max: "HBO_MAX",

	APPLE_TV: "APPLE_TV",
	"apple tv": "APPLE_TV",
	"apple tv+": "APPLE_TV",
	appletv: "APPLE_TV",

	PARAMOUNT_PLUS: "PARAMOUNT_PLUS",
	"paramount+": "PARAMOUNT_PLUS",
	paramountplus: "PARAMOUNT_PLUS",
	"paramount plus": "PARAMOUNT_PLUS",

	PEACOCK: "PEACOCK",
	peacock: "PEACOCK",
}

export function normalizeProviderKey(input: unknown): ProviderKey | null {
	if (!input) return null
	const raw = String(input).trim()
	if (!raw) return null

	const direct = NORMALIZE[raw]
	if (direct) return direct

	const lowered = raw.toLowerCase()
	if (NORMALIZE[lowered]) return NORMALIZE[lowered]

	const snake = lowered.replace(/\s+/g, "_")
	if (NORMALIZE[snake]) return NORMALIZE[snake]

	const nospace = lowered.replace(/\s+/g, "")
	if (NORMALIZE[nospace]) return NORMALIZE[nospace]

	return null
}

export function isProviderKey(value: unknown): value is ProviderKey {
	return normalizeProviderKey(value) !== null
}

export const ALL_PROVIDERS: ProviderKey[] = PROVIDERS.map((p) => p.key)

// Watchmode /sources match helper.
// Some Watchmode source names vary (e.g., "Max", "HBO Max", "Apple TV+").
// This function is used by /api/search to map a Watchmode source to our ProviderKey.

export type WatchmodeSourceLike = {
	name?: string | null
}

export function sourceMatchesProvider(source: WatchmodeSourceLike, provider: ProviderKey): boolean {
	const name = String(source?.name ?? "").toLowerCase()
	if (!name) return false

	switch (provider) {
		case "NETFLIX":
			return name.includes("netflix")

		case "HULU":
			return name.includes("hulu")

		case "PRIME_VIDEO":
			// Watchmode often uses "Amazon Prime Video" or "Prime Video"
			return name.includes("prime") || name.includes("amazon")

		case "DISNEY_PLUS":
			return name.includes("disney")

		case "HBO_MAX":
			// Can be "HBO Max" or "Max"
			return name.includes("hbo") || name === "max" || name.includes(" max")

		case "APPLE_TV":
			// Often "Apple TV+" / "Apple TV Plus"
			return name.includes("apple tv")

		case "PARAMOUNT_PLUS":
			return name.includes("paramount")

		case "PEACOCK":
			return name.includes("peacock")

		default:
			return false
	}
}
