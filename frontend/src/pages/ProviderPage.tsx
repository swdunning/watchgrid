// ProviderPage.tsx
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

type ProviderRowPayload = {
  provider: string;
  label: string;
  mode: "all" | "shows" | "movies";
  genreId: number | null;
  includeGenres: boolean;
  rateLimited?: boolean;
  rows: Array<{
    key: string;
    kind: string;
    title: string;
    page: number;
    canLoadMore: boolean;
    genreId?: number | null;
    items: RowItem[];
  }>;
};

type ProviderMeta = { provider: string; label: string; logoUrl: string | null };
type Genre = { id: number; name: string };

const normalizeTypeLabel = (t?: string | null) => {
  const s = String(t ?? "").trim();
  const lower = s.toLowerCase();

  if (lower === "tv_series" || lower === "tv") return "Series";
  if (lower === "movie") return "Movie";

  // fallback: convert snake_case to Title Case
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
  const [rateLimited, setRateLimited] = useState(false);
  const [modalItem, setModalItem] = useState<RowItem | null>(null);
 

  // Mode / genre filters
  const [mode, setMode] = useState<"all" | "shows" | "movies">("all");
  const [genreId, setGenreId] = useState<string>("all");

  // Rows payload
  const [payload, setPayload] = useState<ProviderRowPayload | null>(null);

  // Search
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RowItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // Per-row loading states for Load More
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});

  // ✅ Keep a ref to each row's horizontal rail so we can auto-scroll after "Load more"
const railRefs = useRef<Record<string, HTMLDivElement | null>>({});


  // (kept; not used right now but harmless)
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

  const loadGenres = async () => {
    try {
      const data = await api<{ genres: Genre[] }>("/api/genres");
      setGenres(Array.isArray(data.genres) ? data.genres : []);
    } catch {
      setGenres([]);
    }
  };

  const loadRows = async (includeGenres: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      const url =
        `/api/provider/${encodeURIComponent(provider)}/rows` +
        `?mode=${mode}` +
        `&genreId=${encodeURIComponent(genreId)}` +
        `&includeGenres=${includeGenres ? "1" : "0"}`;

      const data = await api<ProviderRowPayload>(url);
      setPayload(data);
      setRateLimited(!!data.rateLimited);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load provider page");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeta();
    loadGenres();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    loadRows(false);
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
          provider
        }))
      );
    } catch (e: any) {
      setErr(e?.message ?? "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  };

  /**
   * When TitleCard lazily resolves watchUrl, patch it into:
   * 1) payload rows (all rows)
   * 2) provider-scoped search results
   */
  const applyWatchUrl = (watchmodeTitleId: number, watchUrl: string | null) => {
    if (!watchUrl) return;

    // Patch payload rows
    setPayload((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r) => ({
          ...r,
          items: (r.items || []).map((it) => (it.watchmodeTitleId === watchmodeTitleId ? { ...it, watchUrl } : it))
        }))
      };
    });

    // Patch provider search results
    setResults((prev) => (prev || []).map((it) => (it.watchmodeTitleId === watchmodeTitleId ? { ...it, watchUrl } : it)));
  };

  /**
   * Patch helper: update "my_list" row items without reloading the whole page (zero flicker).
   */
  const patchMyList = (updater: (items: RowItem[]) => RowItem[]) => {
    setPayload((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r) => {
          if (r.kind !== "my_list") return r;
          return { ...r, items: updater(r.items || []) };
        })
      };
    });
  };

  /**
   * ✅ Set of ids currently in My List (used to disable +Add everywhere else)
   */
  const myListIds = useMemo(() => {
    const my = payload?.rows?.find((r) => r.kind === "my_list")?.items ?? [];
    return new Set(my.map((x) => x.watchmodeTitleId));
  }, [payload]);

  /**
   * Optimistic add:
   * 1) insert into my_list immediately
   * 2) POST /lists/add
   * 3) use API response to patch watchUrl so Open works instantly
   * 4) revert on failure
   */
  const addToList = async (item: RowItem) => {
    setErr(null);

    const optimistic: RowItem = {
      ...item,
      provider,
      watchUrl: item.watchUrl ?? null
    };

    // optimistic insert
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
          watchUrl: item.watchUrl
        })
      });

      const saved = res?.item;
      const returnedWatchUrl: string | null = saved?.watchUrl ?? null;

      // patch list + any other spots in this page
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

  /**
   * Optimistic remove:
   * 1) remove from my_list immediately
   * 2) POST /lists/remove
   * 3) revert on failure
   */
  const removeFromList = async (watchmodeTitleId: number) => {
    setErr(null);

    const removed =
      payload?.rows.find((r) => r.kind === "my_list")?.items?.find((x) => x.watchmodeTitleId === watchmodeTitleId) ?? null;

    patchMyList((items) => items.filter((x) => x.watchmodeTitleId !== watchmodeTitleId));

    try {
      await api("/api/lists/remove", {
        method: "POST",
        body: JSON.stringify({ provider, watchmodeTitleId })
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

  const loadGenreRows = async () => {
    await loadRows(true);
  };

  const loadMoreForRow = async (rowKey: string) => {
    if (!payload) return;
    const row = payload.rows.find((r) => r.key === rowKey);
    if (!row || !row.canLoadMore) return;

    setLoadingMore((prev) => ({ ...prev, [rowKey]: true }));
    setErr(null);
	// ✅ Capture where the newly appended items will start (in pixels)
	const railEl = railRefs.current[rowKey];
	const startOfNewItemsPx = railEl?.scrollWidth ?? 0;

    try {
      const nextPage = (row.page ?? 1) + 1;

      const url =
        `/api/provider/${encodeURIComponent(provider)}/browse` +
        `?kind=${encodeURIComponent(row.kind)}` +
        `&mode=${encodeURIComponent(payload.mode)}` +
        `&page=${encodeURIComponent(String(nextPage))}` +
        (row.genreId ? `&genreId=${encodeURIComponent(String(row.genreId))}` : "");

      const more = await api<{ page: number; canLoadMore: boolean; items: RowItem[] }>(url);

      setPayload((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r) => {
            if (r.key !== rowKey) return r;
            return {
              ...r,
              page: more.page,
              canLoadMore: more.canLoadMore,
              items: [...(r.items || []), ...(more.items || [])]
            };
          })
        };
      });

	  // ✅ After DOM updates, scroll so the first newly loaded item is first in view
	requestAnimationFrame(() => {
  	requestAnimationFrame(() => {
		const el = railRefs.current[rowKey];
		if (!el) return;

		// Smooth + snappy (native). Fallback to instant if unsupported.
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

  const hero = useMemo(() => {
    const rows = payload?.rows || [];
    if (!rows.length) return null;

    // Prefer a "trending" row if one exists, otherwise first non-my_list row with items.
    const trendingRow =
      rows.find((r) => String(r.title).toLowerCase().includes("trending") && (r.items?.length ?? 0) > 0) ??
      rows.find((r) => r.kind !== "my_list" && (r.items?.length ?? 0) > 0) ??
      null;

    if (!trendingRow) return null;

    const it = trendingRow.items?.[0] ?? null;
    if (!it) return null;

    return { rowTitle: trendingRow.title, item: it };
  }, [payload]);


  return (
    <>
      <Header
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => nav("/app")}>
              ← Home
            </button>
          </div>
        }
      />

      <div className="page" style={{ display: "grid", gap: 14 }}>
        <div className="card">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {meta?.logoUrl ? <img src={meta.logoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 10 }} /> : null}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0 }}>{label}</h1>
			  
              <div className="muted">Browse and build your {label} list.</div>
			  
            </div>
          </div>

          {/* Hero: Trending (from existing row data, no extra calls) */}
          {hero?.item ? (
            <div
              className="card"
              style={{
                marginTop: 12,
                padding: 0,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "170px 1fr",
                  gap: 14,
                  alignItems: "stretch",
                }}
              >
                <div style={{ padding: 12 }}>
                  {hero.item.poster ? (
                    <img
                      src={hero.item.poster}
                      alt=""
                      style={{ width: 160, height: 240, objectFit: "cover", borderRadius: 14 }}
                    />
                  ) : (
                    <div className="skel skelPoster" />
                  )}
                </div>

                <div
                  style={{
                    position: "relative",
                    padding: "14px 14px 14px 0",
                    minWidth: 0,
                  }}
                >
                  {/* soft background using poster */}
                  {hero.item.poster ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage: `linear-gradient(90deg, rgba(6,5,10,0.92), rgba(6,5,10,0.55)), url(${hero.item.poster})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        filter: "blur(0px)",
                        opacity: 0.9,
                      }}
                    />
                  ) : null}

                  <div style={{ position: "relative" }}>
                    <div className="muted" style={{ fontWeight: 900, letterSpacing: 0.2 }}>
                      Trending on {label}
                    </div>

                    <h2 style={{ margin: "6px 0 6px", maxWidth: 520 }}>
                      {hero.item.title}
                    </h2>

                    <div className="badge" style={{ fontSize: 13 }}>
                      {normalizeTypeLabel(hero.item.type)}
                      {hero.item.provider ? ` • ${hero.item.provider}` : ""}
                    </div>

                    <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {/* Reuse your existing TitleCard behavior by just showing the card in-place */}
                      <button
                        className="btn"
                        style={{ padding: "10px 12px", borderRadius: 12 }}
                        onClick={() => {
                          // Jump the user down to the rail section
                          document.getElementById("wgRowsStart")?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        Browse row →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Provider-scoped search */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <input
              className="input"
              style={{ maxWidth: 560 }}
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

          {/* Mode buttons */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
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

          {/* Genre selector */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
            <div className="muted">Select a Genre:</div>
            <select className="input" style={{ maxWidth: 320 }} value={genreId} onChange={(e) => setGenreId(e.target.value)}>
              <option value="all">All</option>
              {genres.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>

            
          </div>

          {rateLimited && (
            <div className="card" style={{ marginTop: 12, border: "1px solid rgba(255,91,122,0.35)" }}>
              <div style={{ color: "#ff5b7a", fontWeight: 600 }}>We’re temporarily rate-limited by Watchmode. Try again in a few minutes.</div>
            </div>
          )}

          {err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}

          {/* Search rail */}
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
					  onPosterClick={() => setModalItem(r)} // for search result

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

		{/*Browse Titles button anchor */}	
        <div id="wgRowsStart" />

        {/* Rows - with loading rows skeleton shimmer*/}
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
            {(payload?.rows || []).map((row) => {
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
						  onPosterClick={() => setModalItem(it)} // for row item

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
                </div>
              );
            })}

            {!payload?.includeGenres ? (
              <div className="card muted">
                Click <b>Load genre rows</b> below to fetch Genre rows. Or select a Genre from the dropdown above.

                <div style={{ marginTop: 10 }}>
                  <button className="btn secondary" onClick={loadGenreRows}>
                    Load genre rows
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
	  <TitleModal
  open={!!modalItem}
  item={modalItem}
  onClose={() => setModalItem(null)}
/>

    </>
  );
}
