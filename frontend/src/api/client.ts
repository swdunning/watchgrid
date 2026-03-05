/**
 * API client helper
 *
 * Behavior:
 * - In production (Vercel): uses VITE_API_BASE_URL → Railway backend
 * - In local dev: falls back to same-origin so Vite proxy (/api → localhost:4000) works
 *
 * Example final URLs:
 * Local:      /api/home
 * Production: https://watchgrid-production-xxxx.up.railway.app/api/home
 */

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, "") || ""

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
	const url = `${API_BASE}${path}`

	const res = await fetch(url, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(options?.headers ?? {}),
		},
		credentials: "include", // required for cookie-based auth
	})

	const data = await res.json().catch(() => ({}))

	if (!res.ok) {
		throw new Error((data as any)?.message || (data as any)?.error || `Request failed: ${res.status}`)
	}

	return data as T
}
