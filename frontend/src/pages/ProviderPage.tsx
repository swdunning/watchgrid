import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import TitleCard from "../components/TitleCard";
import { api } from "../api/client";

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
    kind: string; // e.g. "my_list", "popular_tv", etc
    title: string;
    page: number;
    canLoadMore: boolean;
    genreId?: number | null;
    items: RowItem[];
  }>;
};

type ProviderMeta = { provider: string; label: string; logoUrl: string | null };
type Genre = { id: number; name: string };

export default function ProviderPage() {
  const nav = useNavigate();
  const { provider: providerParam } = useParams();
  const provider = String(providerParam || "").toUpperCase();

  const [meta, setMeta] = useState<ProviderMeta | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

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

  // Clear search results when query cleared
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
      const data = await api<any[]>(
        `/api/search?q=${encodeURIComponent(term)}&provider=${encodeURIComponent(provider)}`
      );

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

  const addToList = async (item: RowItem) => {
    await api("/api/lists/add", {
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
    await loadRows(payload?.includeGenres ?? false);
  };

  const removeFromList = async (watchmodeTitleId: number) => {
    await api("/api/lists/remove", {
      method: "POST",
      body: JSON.stringify({ provider, watchmodeTitleId })
    });
    await loadRows(payload?.includeGenres ?? false);
  };

  const loadGenreRows = async () => {
    await loadRows(true);
  };

  const loadMoreForRow = async (rowKey: string) => {
    if (!payload) return;
    const row = payload.rows.find((r) => r.key === rowKey);
    if (!row) return;
    if (!row.canLoadMore) return;

    setLoadingMore((prev) => ({ ...prev, [rowKey]: true }));
    setErr(null);

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
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load more");
    } finally {
      setLoadingMore((prev) => ({ ...prev, [rowKey]: false }));
    }
  };

  const label = meta?.label || payload?.label || provider;

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
            {meta?.logoUrl ? (
              <img src={meta.logoUrl} alt="" style={{ width: 42, height: 42, borderRadius: 10 }} />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0 }}>{label}</h1>
              <div className="muted">Browse and build your {label} list.</div>
            </div>
          </div>

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
            <div className="muted">Genre:</div>
            <select
              className="input"
              style={{ maxWidth: 320 }}
              value={genreId}
              onChange={(e) => setGenreId(e.target.value)}
            >
              <option value="all">All</option>
              {Array.isArray(genres) &&
                genres.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
            </select>

            <button className="btn secondary" onClick={loadGenreRows}>
              Load genre rows
            </button>
          </div>

          {rateLimited && (
            <div className="card" style={{ marginTop: 12, border: "1px solid rgba(255,91,122,0.35)" }}>
              <div style={{ color: "#ff5b7a", fontWeight: 600 }}>
                We’re temporarily rate-limited by Watchmode. Try again in a few minutes.
              </div>
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
                {results.map((r) => (
                  <TitleCard
                    key={`${provider}-${r.watchmodeTitleId}`}
                    item={r}
                    action={
                      <button className="btn" style={{ padding: "8px 10px", borderRadius: 10 }} onClick={() => addToList(r)}>
                        + Add
                      </button>
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="card muted">
                {q.trim() ? `No results found on ${label}.` : "Start typing a title, then press Enter."}
              </div>
            )}
          </div>
        </div>

        {/* Rows */}
        {loading ? (
          <div className="card muted">Loading…</div>
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
                    <button
  className="wgPillBtn"
  onClick={() => loadMoreForRow(row.key)}
  disabled={isLoadingMore}
>
  {isLoadingMore ? "Loading…" : "→ Load more"}
</button>


                    ) : null}
                  </div>

                  <div className="rail" style={{ maxWidth: "100%", minWidth: 0 }}>
                    {(row.items || []).map((it) => (
                      <TitleCard
                        key={`${row.key}-${it.watchmodeTitleId}`}
                        item={it}
                        action={
                          isMyList ? (
                            <button
                              className="btn secondary"
                              style={{ padding: "8px 10px", borderRadius: 10 }}
                              onClick={() => removeFromList(it.watchmodeTitleId)}
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              className="btn"
                              style={{ padding: "8px 10px", borderRadius: 10 }}
                              onClick={() => addToList(it)}
                            >
                              + Add
                            </button>
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Convenience: load genre rows at bottom too */}
            {!payload?.includeGenres ? (
              <div className="card muted">
                Genre rows are available — click <b>Load genre rows</b> above to fetch Comedy/Drama/Sci-fi/Action/Mystery/Documentary.
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
    </>
  );
}
