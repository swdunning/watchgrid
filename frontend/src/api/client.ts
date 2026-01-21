export async function api<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(options?.headers ?? {}),
		},
		credentials: "include",
	})

	const data = await res.json().catch(() => ({}))
	if (!res.ok) throw new Error((data as any)?.message || (data as any)?.error || `Request failed: ${res.status}`)
	return data as T
}
