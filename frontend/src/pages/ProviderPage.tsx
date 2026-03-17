import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import TitleCard from "../components/TitleCard";
import { api } from "../api/client";
import TitleModal from "../components/TitleModal";

type RowItem = {
	watchmodeTitleId: number;
	title: string;
	type: string;
	poster: string | null;
	watchUrl?: string | null;
	provider?: string;
};

type Row = {
	key: string;
	kind: string;
	title: string;
	page: number;
	canLoadMore: boolean;
	genreId?: number | null;
	items: RowItem[];
};

type ProviderRowPayload = {
	provider: string;
	label: string;
	mode: "all" | "shows" | "movies";
	genreId: number | null;
	rateLimited?: boolean;
	rows: Row[];
};

type GenresPagePayload = {
	provider: string;
	label: string;
	mode: "all" | "shows" | "movies";
	page: number;
	pageSize: number;
	total: number;
	canLoadMore: boolean;
	rateLimited?: boolean;
	rows: Row[];
};

type ProviderMeta = { provider: string; label: string; logoUrl: string | null };
type Genre = { id: number; name: string };

const ROW_RETRY_LIMIT = 2;
const ROW_RETRY_DELAY_MS = 4000;

const normalizeTypeLabel = (t?: string | null) => {
	const s = String(t ?? "").trim();
	const lower = s.toLowerCase();

	if (lower === "tv_series" || lower === "tv") return "Series";
	if (lower === "movie") return "Movie";

	return s
		? s
			.replace(/_/g, " ")
			.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
		: "";
};

export default function ProviderPage() {
	const nav = useNavigate();
	const { provider: providerParam } = useParams();
	const provider = String(providerParam || "").toUpperCase();

	const [meta, setMeta] = useState<ProviderMeta | null>(null);
	const [genres, setGenres] = useState<Genre[]>([]);
	const [loading, setLoading] = useState(true);
	const [err, setErr] = useState<string | null>(null);

	const [modalItem, setModalItem] = useState<RowItem | null>(null);

	const [mode, setMode] = useState<"all" | "shows" | "movies">("all");
	const [genreId, setGenreId] = useState<string>("all");

	const [payload, setPayload] = useState<ProviderRowPayload | null>(null);

	const [genreRows, setGenreRows] = useState<Row[]>([]);
	const [genresPage, setGenresPage] = useState(0);
	const [canLoadMoreGenres, setCanLoadMoreGenres] = useState(false);
	const [loadingGenres, setLoadingGenres] = useState(false);

	const [q, setQ] = useState("");
	const [results, setResults] = useState<RowItem[]>([]);
	const [searchOpen, setSearchOpen] = useState(false);
	const [loadingSearch, setLoadingSearch] = useState(false);

	const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});

	const [rowRetryCounts, setRowRetryCounts] = useState<Record<string, number>>({});
	const [refreshingRows, setRefreshingRows] = useState<Record<string, boolean>>({});

	const providerDebugEmpty = useMemo(() => {
		const params = new URLSearchParams(window.location.search);
		return (params.get("wgDebugEmpty") || "").trim().toLowerCase();
	}, []);

	const railRefs = useRef<Record<string, HTMLDivElement | null>>({});

	const selectedGenreNum = useMemo(() => (genreId === "all" ? null : Number(genreId)), [genreId]);

	const loadMeta = async () => {
		try {
			const data = await api<{ providers: ProviderMeta[] }>("/api/meta/providers");
			const found = (data.providers || []).find((p) => String(p.provider).toUpperCase() === provider) || null;
			setMeta(found);
		} catch {
			// ignore
		}
	};

	const loadGenresList = async () => {
		try {
			const data = await api<{ genres: Genre[] }>(
				`/api/provider/${encodeURIComponent(provider)}/genre-options?mode=${encodeURIComponent(mode)}`
			);

			const nextGenres = Array.isArray(data.genres) ? data.genres : [];
			setGenres(nextGenres);

			if (genreId !== "all") {
				const stillValid = nextGenres.some((g) => String(g.id) === String(genreId));
				if (!stillValid) {
					setGenreId("all");
				}
			}
		} catch {
			setGenres([]);
			if (genreId !== "all") setGenreId("all");
		}
	};

	const resetCuratedGenres = () => {
		setGenreRows([]);
		setGenresPage(0);
		setCanLoadMoreGenres(false);
		setLoadingGenres(false);
	};

	const loadRows = async () => {
		setLoading(true);
		setErr(null);
		setRowRetryCounts({});
		setRefreshingRows({});
		resetCuratedGenres();

		try {
			const url =
				`/api/provider/${encodeURIComponent(provider)}/rows` +
				`?mode=${mode}` +
				`&genreId=${encodeURIComponent(genreId)}`;

			const data = await api<ProviderRowPayload>(url);
			setPayload(data);
		} catch (e: any) {
			setErr(e?.message ?? "Failed to load provider page");
		} finally {
			setLoading(false);
		}
	};

	const loadCuratedGenresPage = async (page: number) => {
		setLoadingGenres(true);
		setErr(null);

		try {
			const url =
				`/api/provider/${encodeURIComponent(provider)}/genres` +
				`?mode=${encodeURIComponent(mode)}` +
				`&page=${encodeURIComponent(String(page))}`;

			const data = await api<GenresPagePayload>(url);

			setGenreRows((prev) => {
				const existing = new Set(prev.map((r) => r.key));
				const add = (data.rows || []).filter((r) => !existing.has(r.key));
				return [...prev, ...add];
			});

			setGenresPage(data.page ?? page);
			setCanLoadMoreGenres(!!data.canLoadMore);
		} catch (e: any) {
			setErr(e?.message ?? "Failed to load genre rows");
		} finally {
			setLoadingGenres(false);
		}
	};

	const loadGenresFirst = async () => {
		if (loadingGenres) return;
		await loadCuratedGenresPage(1);
	};

	const loadMoreGenres = async () => {
		if (loadingGenres) return;
		const next = (genresPage || 0) + 1;
		await loadCuratedGenresPage(next);
	};

	const providerDebugSlowRefresh = useMemo(() => {
		const params = new URLSearchParams(window.location.search);
		return params.get("wgDebugSlowRefresh") === "1";
	}, []);

	const refreshSingleRow = async (row: Row) => {
		const rowKey = row.key;
		setRefreshingRows((prev) => ({ ...prev, [rowKey]: true }));

		if (providerDebugSlowRefresh) {
			await new Promise((resolve) => setTimeout(resolve, 1200));
		}
		try {
			const url =
				`/api/provider/${encodeURIComponent(provider)}/row` +
				`?kind=${encodeURIComponent(row.kind)}` +
				`&mode=${encodeURIComponent(payload?.mode ?? mode)}` +
				(row.genreId ? `&genreId=${encodeURIComponent(String(row.genreId))}` : "");

			const data = await api<{ row: Row }>(url);
			const nextRow = data.row;

			setPayload((prev) => {
				if (!prev) return prev;
				if (!prev.rows.some((r) => r.key === rowKey)) return prev;

				return {
					...prev,
					rows: prev.rows.map((r) => (r.key === rowKey ? nextRow : r)),
				};
			});

			setGenreRows((prev) => {
				if (!prev.some((r) => r.key === rowKey)) return prev;
				return prev.map((r) => (r.key === rowKey ? nextRow : r));
			});
		} catch (e: any) {
			console.warn("Failed to refresh provider row:", row.key, e?.message ?? e);
		} finally {
			setRefreshingRows((prev) => ({ ...prev, [rowKey]: false }));
			setRowRetryCounts((prev) => ({ ...prev, [rowKey]: (prev[rowKey] ?? 0) + 1 }));
		}
	};

	useEffect(() => {
		loadMeta();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [provider]);

	useEffect(() => {
		loadGenresList();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [provider, mode]);

	useEffect(() => {
		loadRows();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [provider, mode, genreId]);

	useEffect(() => {
		if (q.trim() === "") setResults([]);
	}, [q]);

	const closeSearch = () => {
		setSearchOpen(false);
		setQ("");
		setResults([]);
		setErr(null);
	};

	const runSearch = async () => {
		const term = q.trim();
		if (!term) {
			setResults([]);
			setSearchOpen(false);
			return;
		}

		setLoadingSearch(true);
		setErr(null);
		setResults([]);

		try {
			const data = await api<any[]>(`/api/search?q=${encodeURIComponent(term)}&provider=${encodeURIComponent(provider)}`);

			setResults(
				(data || []).map((r: any) => ({
					watchmodeTitleId: r.watchmodeTitleId,
					title: r.title,
					type: r.type,
					poster: r.poster ?? null,
					watchUrl: r.watchUrl ?? null,
					provider,
				}))
			);
		} catch (e: any) {
			setErr(e?.message ?? "Search failed");
		} finally {
			setLoadingSearch(false);
		}
	};

	const applyWatchUrl = (watchmodeTitleId: number, watchUrl: string | null) => {
		if (!watchUrl) return;

		setPayload((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				rows: prev.rows.map((r) => ({
					...r,
					items: (r.items || []).map((it) => (it.watchmodeTitleId === watchmodeTitleId ? { ...it, watchUrl } : it)),
				})),
			};
		});

		setGenreRows((prev) =>
			(prev || []).map((r) => ({
				...r,
				items: (r.items || []).map((it) => (it.watchmodeTitleId === watchmodeTitleId ? { ...it, watchUrl } : it)),
			}))
		);

		setResults((prev) => (prev || []).map((it) => (it.watchmodeTitleId === watchmodeTitleId ? { ...it, watchUrl } : it)));
	};

	const patchMyList = (updater: (items: RowItem[]) => RowItem[]) => {
		setPayload((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				rows: prev.rows.map((r) => {
					if (r.kind !== "my_list") return r;
					return { ...r, items: updater(r.items || []) };
				}),
			};
		});
	};

	const myListIds = useMemo(() => {
		const my = payload?.rows?.find((r) => r.kind === "my_list")?.items ?? [];
		return new Set(my.map((x) => x.watchmodeTitleId));
	}, [payload]);

	const addToList = async (item: RowItem) => {
		setErr(null);

		const optimistic: RowItem = {
			...item,
			provider,
			watchUrl: item.watchUrl ?? null,
		};

		patchMyList((items) => {
			const exists = items.some((x) => x.watchmodeTitleId === optimistic.watchmodeTitleId);
			if (exists) return items;
			return [optimistic, ...items];
		});

		try {
			const res = await api<{ item: any }>("/api/lists/add", {
				method: "POST",
				body: JSON.stringify({
					provider,
					watchmodeTitleId: item.watchmodeTitleId,
					title: item.title,
					type: item.type,
					poster: item.poster,
					watchUrl: item.watchUrl,
				}),
			});

			const saved = res?.item;
			const returnedWatchUrl: string | null = saved?.watchUrl ?? null;

			if (returnedWatchUrl) {
				patchMyList((items) =>
					items.map((x) => (x.watchmodeTitleId === optimistic.watchmodeTitleId ? { ...x, watchUrl: returnedWatchUrl } : x))
				);
				applyWatchUrl(optimistic.watchmodeTitleId, returnedWatchUrl);
			}
		} catch (e: any) {
			patchMyList((items) => items.filter((x) => x.watchmodeTitleId !== optimistic.watchmodeTitleId));
			setErr(e?.message ?? "Failed to add");
		}
	};

	const removeFromList = async (watchmodeTitleId: number) => {
		setErr(null);

		const removed =
			payload?.rows.find((r) => r.kind === "my_list")?.items?.find((x) => x.watchmodeTitleId === watchmodeTitleId) ?? null;

		patchMyList((items) => items.filter((x) => x.watchmodeTitleId !== watchmodeTitleId));

		try {
			await api("/api/lists/remove", {
				method: "POST",
				body: JSON.stringify({ provider, watchmodeTitleId }),
			});
		} catch (e: any) {
			if (removed) {
				patchMyList((items) => {
					const exists = items.some((x) => x.watchmodeTitleId === watchmodeTitleId);
					if (exists) return items;
					return [removed, ...items];
				});
			}
			setErr(e?.message ?? "Failed to remove");
		}
	};

	const loadMoreForRow = async (rowKey: string) => {
		const allRows: Row[] = [...(payload?.rows || []), ...(genreRows || [])];
		const row = allRows.find((r) => r.key === rowKey);
		if (!row || !row.canLoadMore) return;

		setLoadingMore((prev) => ({ ...prev, [rowKey]: true }));
		setErr(null);

		const railEl = railRefs.current[rowKey];
		const startOfNewItemsPx = railEl?.scrollWidth ?? 0;

		try {
			const nextPage = (row.page ?? 1) + 1;

			const url =
				`/api/provider/${encodeURIComponent(provider)}/browse` +
				`?kind=${encodeURIComponent(row.kind)}` +
				`&mode=${encodeURIComponent(payload?.mode ?? mode)}` +
				`&page=${encodeURIComponent(String(nextPage))}` +
				(row.genreId ? `&genreId=${encodeURIComponent(String(row.genreId))}` : "");

			const more = await api<{ page: number; canLoadMore: boolean; items: RowItem[] }>(url);

			setPayload((prev) => {
				if (!prev) return prev;
				const found = prev.rows.some((r) => r.key === rowKey);
				if (!found) return prev;
				return {
					...prev,
					rows: prev.rows.map((r) => {
						if (r.key !== rowKey) return r;
						return {
							...r,
							page: more.page,
							canLoadMore: more.canLoadMore,
							items: [...(r.items || []), ...(more.items || [])],
						};
					}),
				};
			});

			setGenreRows((prev) => {
				const found = prev.some((r) => r.key === rowKey);
				if (!found) return prev;
				return prev.map((r) => {
					if (r.key !== rowKey) return r;
					return {
						...r,
						page: more.page,
						canLoadMore: more.canLoadMore,
						items: [...(r.items || []), ...(more.items || [])],
					};
				});
			});

			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					const el = railRefs.current[rowKey];
					if (!el) return;
					try {
						el.scrollTo({ left: startOfNewItemsPx, behavior: "smooth" });
					} catch {
						el.scrollLeft = startOfNewItemsPx;
					}
				});
			});
		} catch (e: any) {
			setErr(e?.message ?? "Failed to load more");
		} finally {
			setLoadingMore((prev) => ({ ...prev, [rowKey]: false }));
		}
	};

	const label = meta?.label || payload?.label || provider;

	const trendingItems = useMemo(() => {
		const rows = payload?.rows || [];
		if (!rows.length) return [];

		const trendingRow =
			rows.find((r) => String(r.title).toLowerCase().includes("trending") && (r.items?.length ?? 0) > 0) ??
			rows.find((r) => r.kind !== "my_list" && (r.items?.length ?? 0) > 0) ??
			null;

		if (!trendingRow) return [];
		return (trendingRow.items || []).slice(0, 3);
	}, [payload]);

	const [isHeroPaused, setIsHeroPaused] = useState(false);
	const [heroIndex, setHeroIndex] = useState(0);

	useEffect(() => {
		if (!trendingItems.length || isHeroPaused) return;
		const id = setInterval(() => {
			setHeroIndex((prev) => (prev + 1) % trendingItems.length);
		}, 10000);
		return () => clearInterval(id);
	}, [trendingItems, isHeroPaused]);

	const heroItem = trendingItems[heroIndex] ?? null;

	const renderedRows: Row[] = useMemo(() => {
		return [...(payload?.rows || []), ...(genreRows || [])];
	}, [payload, genreRows]);

	useEffect(() => {
		if (loading) return;

		const candidates = (renderedRows || []).filter((row) => {
			const isMyList = row.kind === "my_list";
			const retryCount = rowRetryCounts[row.key] ?? 0;
			const refreshing = !!refreshingRows[row.key];

			const hasItems = (row.items?.length ?? 0) > 0;
			const debugForced = shouldForceProviderEmptyRow(row);

			const needsRetry = !hasItems || debugForced;

			return !isMyList && needsRetry && !refreshing && retryCount < ROW_RETRY_LIMIT;
		});

		if (!candidates.length) return;

		const timers = candidates.map((row) =>
			window.setTimeout(() => {
				refreshSingleRow(row);
			}, ROW_RETRY_DELAY_MS)
		);

		return () => timers.forEach(clearTimeout);
	}, [renderedRows, loading, rowRetryCounts, refreshingRows]);

	const shouldForceProviderEmptyRow = (row: Row) => {
		if (!providerDebugEmpty) return false;

		if (providerDebugEmpty === "1" || providerDebugEmpty === "all") {
			return row.kind !== "my_list";
		}

		if (providerDebugEmpty === "genre") {
			return row.kind === "genre" || row.kind === "genre_tv" || row.kind === "genre_movies";
		}

		if (providerDebugEmpty === "popular") {
			return row.kind === "popular_tv" || row.kind === "popular_movies";
		}

		if (providerDebugEmpty === "new") {
			return row.kind === "new";
		}

		return row.key === providerDebugEmpty || row.kind === providerDebugEmpty;
	};

	return (
		<>
			<Header
				right={
					<div className="headerRight">
						<button className="btn secondary" onClick={() => nav("/app")}>
							← Home
						</button>
					</div>
				}
			/>

			<div className="page" style={{ display: "grid", gap: 14 }}>
				<div className="card">
					<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
						{meta?.logoUrl ? <img src={meta.logoUrl} alt="" style={{ width: 60, height: 60, borderRadius: 10 }} /> : null}
						<div style={{ minWidth: 0 }}>
							<h1 style={{ margin: 0 }}>{label}</h1>
							<div className="muted">Browse and build your {label} list.</div>
						</div>
					</div>

					{heroItem ? (
						<div
							className="card heroBanner"
							style={{ marginTop: 12, padding: 0, overflow: "hidden" }}
							onMouseEnter={() => setIsHeroPaused(true)}
							onMouseLeave={() => setIsHeroPaused(false)}
						>
							<div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 14, alignItems: "stretch" }}>
								<div key={`poster-${heroItem.watchmodeTitleId}`} style={{ padding: 12, zIndex: 2, animation: "heroFade 2000ms ease" }}>
									{heroItem.poster ? (
										<img
											src={heroItem.poster}
											alt=""
											style={{
												width: 160,
												height: 240,
												objectFit: "cover",
												borderRadius: 14,
												border: "2px solid rgba(255,255,255,0.10)",
												boxShadow: "0 18px 50px rgba(0, 0, 0, 0.85)",
											}}
										/>
									) : (
										<div className="skel skelPoster" />
									)}
								</div>

								<div style={{ padding: "14px 14px 14px 0", minWidth: 0 }}>
									{heroItem.poster ? (
										<>
											<div className="heroBackdrop" style={{ backgroundImage: `url(${heroItem.poster})` }} />
											<div className="heroGrain" />
										</>
									) : null}

									<div key={heroItem.watchmodeTitleId} style={{ position: "relative", animation: "heroFade 2000ms ease" }}>
										<div className="muted" style={{ fontWeight: 900, letterSpacing: 0.2 }}>
											Trending on {label}
										</div>

										<h2 style={{ margin: "6px 0 6px", maxWidth: 520 }}>{heroItem.title}</h2>

										<div className="badge" style={{ fontSize: 13 }}>
											{normalizeTypeLabel(heroItem.type)}
											{heroItem.provider ? ` • ${heroItem.provider}` : ""}
										</div>

										<div style={{ marginTop: 18, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
											<button
												className="btn"
												style={{ padding: "12px 18px", borderRadius: 14, fontSize: 14, fontWeight: 700, boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }}
												onClick={() => {
													document.getElementById("wgRowsStart")?.scrollIntoView({ behavior: "smooth", block: "start" });
												}}
											>
												Browse Titles →
											</button>

											{heroItem && !myListIds.has(heroItem.watchmodeTitleId) ? (
												<button
													className="btn"
													style={{ padding: "12px 18px", borderRadius: 14, fontSize: 14, fontWeight: 700, background: "var(--purple)", boxShadow: "0 8px 24px rgba(109,40,217,0.45)" }}
													onClick={() => addToList(heroItem)}
												>
													+ Add to List
												</button>
											) : heroItem ? (
												<button className="btn secondary" style={{ padding: "12px 18px", borderRadius: 14, fontSize: 15, fontWeight: 900 }} disabled>
													✓ Added
												</button>
											) : null}
										</div>

										<div style={{ display: "flex", justifyContent: "center", marginTop: 62 }}>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: 14,
													padding: "8px 16px",
													borderRadius: 999,
													background: "rgba(0, 0, 0, 0.69)",
													border: "1px solid rgba(255, 255, 255, 0.33)",
													backdropFilter: "blur(6px)",
												}}
											>
												<button
													className="heroArrowBtn"
													type="button"
													onClick={() => setHeroIndex((i) => (i - 1 + trendingItems.length) % trendingItems.length)}
													aria-label="Previous"
												>
													<span className="heroArrow left">❮</span>
												</button>

												<div style={{ marginTop: 0, display: "flex", gap: 6 }}>
													{trendingItems.map((_, i) => (
														<div
															key={i}
															onClick={() => setHeroIndex(i)}
															style={{
																width: 8,
																height: 8,
																borderRadius: 999,
																cursor: "pointer",
																transition: "all 200ms ease",
																background: i === heroIndex ? "var(--wg-purple)" : "rgba(255, 255, 255, 0.5)",
																transform: i === heroIndex ? "scale(1.2)" : "scale(1)",
															}}
														/>
													))}
												</div>

												<button className="heroArrowBtn" type="button" onClick={() => setHeroIndex((i) => (i + 1) % trendingItems.length)} aria-label="Next">
													<span className="heroArrow right">❯</span>
												</button>
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					) : null}

					<div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 30 }}>
						<input
							className="inputSearch"
							style={{ maxWidth: 480 }}
							value={q}
							onChange={(e) => setQ(e.target.value)}
							onFocus={() => setSearchOpen(true)}
							placeholder={`Search ${label}…`}
							onKeyDown={(e) => (e.key === "Enter" ? runSearch() : null)}
						/>
						<button className="btn" onClick={runSearch} disabled={loadingSearch}>
							{loadingSearch ? "Searching…" : "Search"}
						</button>
					</div>

					<div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26, alignItems: "center" }}>
						<div className="muted"> Select a Genre:</div>
						<select className="input" style={{ maxWidth: 440 }} value={genreId} onChange={(e) => setGenreId(e.target.value)}>
							<option value="all">All</option>
							{genres.map((g) => (
								<option key={g.id} value={String(g.id)}>
									{g.name}
								</option>
							))}
						</select>
					</div>

					<div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 36 }}>
						<button className={`btn ${mode === "all" ? "" : "secondary"}`} onClick={() => setMode("all")}>
							TV Shows & Movies
						</button>
						<button className={`btn ${mode === "shows" ? "" : "secondary"}`} onClick={() => setMode("shows")}>
							TV Shows
						</button>
						<button className={`btn ${mode === "movies" ? "" : "secondary"}`} onClick={() => setMode("movies")}>
							Movies
						</button>
					</div>

					{err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}

					<div className={`searchPanel ${searchOpen ? "open" : ""}`}>
						<div className="searchPanelHeader">
							<div className="searchPanelTitle">
								<h2 style={{ margin: 0 }}>Search</h2>
								<div className="muted">{q.trim() ? `Results for “${q.trim()}”` : "Type to search…"}</div>
							</div>

							<button className="searchCloseBtn" onClick={closeSearch} aria-label="Close search">
								✕
							</button>
						</div>

						{!!results.length ? (
							<div className="rail">
								{results.map((r) => {
									const alreadyAdded = myListIds.has(r.watchmodeTitleId);
									return (
										<TitleCard
											key={`${provider}-${r.watchmodeTitleId}`}
											item={r}
											onWatchUrlResolved={(url) => applyWatchUrl(r.watchmodeTitleId, url)}
											onPosterClick={() => setModalItem(r)}
											action={
												<button
													className={`btn ${alreadyAdded ? "secondary" : ""}`}
													style={{ padding: "8px 10px", borderRadius: 10 }}
													onClick={() => addToList(r)}
													disabled={alreadyAdded}
													title={alreadyAdded ? "Already in your list" : "Add to your list"}
												>
													{alreadyAdded ? "Added" : "+ Add"}
												</button>
											}
										/>
									);
								})}
							</div>
						) : (
							<div className="card muted">{q.trim() ? `No results found on ${label}.` : "Start typing a title, then press Enter."}</div>
						)}
					</div>
				</div>

				<div id="wgRowsStart" />

				{loading ? (
					<div style={{ display: "grid", gap: 14 }}>
						<div className="card">
							<div className="skel skelText" style={{ width: 240, marginBottom: 10 }} />
							<div className="skel skelText sm" style={{ width: 360 }} />
						</div>

						<div className="wgRow">
							<div className="wgRowHeader">
								<div className="wgRowTitleWrap">
									<div className="skel skelText" style={{ width: 220 }} />
								</div>
								<div className="skel skelBtn" style={{ width: 120 }} />
							</div>

							<div className="rail">
								{Array.from({ length: 6 }).map((_, i) => (
									<div key={i} className="skel skelPoster" />
								))}
							</div>
						</div>
					</div>
				) : (
					<div style={{ display: "grid", gap: 14 }}>
						{renderedRows.map((row) => {
							const isMyList = row.kind === "my_list";
							const canLoadMore = !!row.canLoadMore;
							const isLoadingMore = !!loadingMore[row.key];

							return (
								<div key={row.key} className="wgRow" style={{ maxWidth: "100%", minWidth: 0 }}>
									<div className="wgRowHeader">
										<div className="wgRowTitleWrap">
											<div className="wgRowTitle">{row.title}</div>
										</div>

										{!isMyList && canLoadMore ? (
											<button className="wgPillBtn" onClick={() => loadMoreForRow(row.key)} disabled={isLoadingMore}>
												{isLoadingMore ? "Loading…" : "→ Load more"}
											</button>
										) : null}
									</div>

									{(row.items || []).length === 0 || shouldForceProviderEmptyRow(row) ? (
										<div className="wgEmptyRowState">
											<div className="wgEmptyRowStateText">
												{isMyList
													? `You haven't added anything to your ${label} list yet.`
													: refreshingRows[row.key]
														? `Refreshing ${row.title.toLowerCase()}…`
														: `${row.title} is loading or temporarily empty. The row will auto reload in a moment.`}
											</div>
										</div>
									) : (
											<div
												className="rail"
												style={{ maxWidth: "100%", minWidth: 0 }}
												ref={(el) => {
													railRefs.current[row.key] = el;
												}}
											>
												{(row.items || []).map((it) => {
													const alreadyAdded = !isMyList && myListIds.has(it.watchmodeTitleId);

												return (
													<TitleCard
														key={`${row.key}-${it.watchmodeTitleId}`}
														item={it}
														onWatchUrlResolved={(url) => applyWatchUrl(it.watchmodeTitleId, url)}
														onPosterClick={() => setModalItem(it)}
														action={
															isMyList ? (
																<button
																	className="btn danger"
																	style={{ padding: "8px 9px", borderRadius: 10 }}
																	onClick={() => removeFromList(it.watchmodeTitleId)}
																>
																	– Remove
																</button>
															) : (
																<button
																	className={`btn ${alreadyAdded ? "secondary" : ""}`}
																	style={{ padding: "8px 10px", borderRadius: 10 }}
																	onClick={() => addToList(it)}
																	disabled={alreadyAdded}
																	title={alreadyAdded ? "Already in your list" : "Add to your list"}
																>
																	{alreadyAdded ? "Added" : "+ Add"}
																</button>
															)
														}
													/>
												);
											})}
											</div>
									)}
								</div>
							);
						})}

						{selectedGenreNum === null ? (
							<div className="card muted">
								Load genre rows below. Or select a specific Genre from the dropdown above.
								<div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
									{genresPage === 0 ? (
										<button className="btn secondary" onClick={loadGenresFirst} disabled={loadingGenres}>
											{loadingGenres ? "Loading…" : "Load genre rows"}
										</button>
									) : canLoadMoreGenres ? (
										<button className="btn secondary" onClick={loadMoreGenres} disabled={loadingGenres}>
											{loadingGenres ? "Loading…" : "Load More Genres"}
										</button>
									) : (
										<div className="muted">All genres loaded.</div>
									)}
								</div>
							</div>
						) : null}
					</div>
				)}
			</div>

			<TitleModal open={!!modalItem} item={modalItem} onClose={() => setModalItem(null)} />
		</>
	);
}