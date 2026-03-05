// AllLists.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import TitleCard from "../components/TitleCard";
import { api } from "../api/client";
import TitleModal from "../components/TitleModal";


type SavedItem = {
  id: string;
  watchmodeTitleId: number;
  title: string;
  type: string;
  poster: string | null;
  watchUrl?: string | null;
  provider: string;
  genres: string[];
  genresStatus: "PENDING" | "OK" | "NONE" | "ERROR";
};

type ProviderMeta = {
  provider: string;
  label: string;
  logoUrl: string | null;
};

export default function AllLists() {
  const nav = useNavigate();

  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // mode filter
  const [mode, setMode] = useState<"all" | "shows" | "movies">("all");

  // provider chips with logos (multi-select)
  const [metaMap, setMetaMap] = useState<Record<string, ProviderMeta>>({});
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());

  const [modalItem, setModalItem] = useState<SavedItem | null>(null);

  // search rail
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SavedItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // collapse/expand genres
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const isTv = (it: SavedItem) => String(it.type).toLowerCase().includes("tv");

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api<{ items: SavedItem[] }>("/api/lists/all");
      setItems(data.items || []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load All My Lists");
    } finally {
      setLoading(false);
    }
  };

  const loadProviderMeta = async () => {
    try {
      const data = await api<{ providers: ProviderMeta[] }>("/api/meta/providers");
      const map: Record<string, ProviderMeta> = {};
      for (const p of data.providers || []) map[p.provider] = p;
      setMetaMap(map);
    } catch {
      // optional
    }
  };

  useEffect(() => {
    load();
    loadProviderMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (q.trim() === "") setResults([]);
  }, [q]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQ("");
    setResults([]);
    setErr(null);
  };

  const providerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) s.add(it.provider);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const toggleProvider = (p: string) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const clearProviders = () => setSelectedProviders(new Set());

  const providerFiltered = useMemo(() => {
    if (selectedProviders.size === 0) return items;
    return items.filter((it) => selectedProviders.has(it.provider));
  }, [items, selectedProviders]);

  const filteredItems = useMemo(() => {
    if (mode === "all") return providerFiltered;
    const wantTv = mode === "shows";
    return providerFiltered.filter((it) => (wantTv ? isTv(it) : !isTv(it)));
  }, [providerFiltered, mode]);

  const runSearch = () => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setSearchOpen(false);
      return;
    }
    const lower = term.toLowerCase();
    setResults(filteredItems.filter((it) => it.title.toLowerCase().includes(lower)));
  };

  /**
   * When TitleCard lazily resolves watchUrl, patch it into:
   * - items
   * - results
   */
  const applyWatchUrl = (provider: string, watchmodeTitleId: number, watchUrl: string | null) => {
    if (!watchUrl) return;

    setItems((prev) =>
      (prev || []).map((it) =>
        it.provider === provider && it.watchmodeTitleId === watchmodeTitleId ? { ...it, watchUrl } : it
      )
    );

    setResults((prev) =>
      (prev || []).map((it) =>
        it.provider === provider && it.watchmodeTitleId === watchmodeTitleId ? { ...it, watchUrl } : it
      )
    );
  };

  // Genre bucketing: alphabetical, Unknown genre always last
  const bucketGenres = (it: SavedItem): string[] => {
    if (it.genresStatus === "OK" && Array.isArray(it.genres) && it.genres.length > 0) return it.genres;
    return ["Unknown genre"];
  };

  const genreRows = useMemo(() => {
    const map = new Map<string, SavedItem[]>();

    for (const it of filteredItems) {
      for (const g of bucketGenres(it)) {
        if (!map.has(g)) map.set(g, []);
        map.get(g)!.push(it);
      }
    }

    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      if (a[0] === "Unknown genre") return 1;
      if (b[0] === "Unknown genre") return -1;
      return a[0].localeCompare(b[0]);
    });

    return entries;
  }, [filteredItems]);

  const toggleGenreCollapse = (genre: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(genre)) next.delete(genre);
      else next.add(genre);
      return next;
    });
  };

  const retryGenres = async (id: string) => {
    try {
      await api("/api/lists/genres/retry", {
        method: "POST",
        body: JSON.stringify({ id })
      });
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Retry failed");
    }
  };

  /**
   * Optimistic remove from AllLists:
   * - removes from main list and any current search results
   * - reverts on failure
   */
  const removeSaved = async (provider: string, watchmodeTitleId: number) => {
    setErr(null);

    const removed = items.find((x) => x.provider === provider && x.watchmodeTitleId === watchmodeTitleId) ?? null;

    setItems((prev) => prev.filter((x) => !(x.provider === provider && x.watchmodeTitleId === watchmodeTitleId)));
    setResults((prev) => prev.filter((x) => !(x.provider === provider && x.watchmodeTitleId === watchmodeTitleId)));

    try {
      await api("/api/lists/remove", {
        method: "POST",
        body: JSON.stringify({ provider, watchmodeTitleId })
      });
    } catch (e: any) {
      if (removed) {
        setItems((prev) => {
          const exists = prev.some((x) => x.provider === provider && x.watchmodeTitleId === watchmodeTitleId);
          return exists ? prev : [removed, ...prev];
        });
      }
      setErr(e?.message ?? "Failed to remove");
    }
  };

  const unknownBadge = (
    <span
      className="badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.06)",
        color: "rgba(255,255,255,0.75)",
        fontWeight: 800
      }}
      title="We couldn't resolve genres for this title yet."
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--wg-purple)" }} />
      Unknown genre
    </span>
  );

  const savedItemActions = (it: SavedItem) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button
        className="btn danger"
        style={{ padding: "8px 9px", borderRadius: 10 }}
        onClick={() => removeSaved(it.provider, it.watchmodeTitleId)}
      >
        – Remove
      </button>

      {it.genresStatus === "ERROR" ? (
        <>
          {unknownBadge}
          <button className="wgPillBtn" style={{ padding: "8px 12px" }} onClick={() => retryGenres(it.id)}>
            Retry
          </button>
        </>
      ) : null}
    </div>
  );

  return (
    <>
      <Header
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => nav("/app")}>
              ← Back
            </button>
          </div>
        }
      />

      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>All My Lists</h1>
          <p className="muted">Everything you saved, grouped into genre rows.</p>

          {/* Search */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <input
              className="input"
              style={{ maxWidth: 560 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search within All My Lists…"
              onKeyDown={(e) => (e.key === "Enter" ? runSearch() : null)}
            />
            <button className="btn" onClick={runSearch}>
              Search
            </button>
          </div>

          {/* Mode toggle */}
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

          {/* Provider chips with logos */}
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontWeight: 800, marginBottom: 8 }}>
              Filter by provider
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className={`btn ${selectedProviders.size === 0 ? "" : "secondary"}`} onClick={clearProviders}>
                All
              </button>

              {providerOptions.map((p) => {
                const active = selectedProviders.has(p);
                const meta = metaMap[p];
                const label = meta?.label ?? p;
                const logoUrl = meta?.logoUrl ?? null;

                return (
                  <button
                    key={p}
                    className={`btn ${active ? "" : "secondary"}`}
                    onClick={() => toggleProvider(p)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
                    title={label}
                  >
                    {logoUrl ? (
                      <img src={logoUrl} alt="" style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
                    ) : null}
                    <span style={{ fontWeight: 900 }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

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
                    key={`${r.provider}-${r.watchmodeTitleId}`}
                    item={{
                      watchmodeTitleId: r.watchmodeTitleId,
                      title: r.title,
                      type: r.type,
                      poster: r.poster ?? null,
                      watchUrl: r.watchUrl ?? null,
                      provider: r.provider,
					  genres: r.genres,
  					  genresStatus: r.genresStatus
                    }}
                    onWatchUrlResolved={(url) => applyWatchUrl(r.provider, r.watchmodeTitleId, url)}
					onPosterClick={() => setModalItem(r)} // or it

                    action={savedItemActions(r)}
                  />
                ))}
              </div>
            ) : (
              <div className="card muted">{q.trim() ? "No matches in your saved lists." : "Start typing a title, then press Enter."}</div>
            )}
          </div>
        </div>

        {/* TOP ROW: All My Lists */}
        <div className="wgRow" style={{ marginTop: 14 }}>
          <div className="wgRowHeader">
            <div className="wgRowTitleWrap">
              <div className="wgRowTitle">All My Lists</div>
              <div className="muted" style={{ fontWeight: 800 }}>
                ({filteredItems.length})
              </div>
            </div>
          </div>

          <div className="rail">
            {filteredItems.map((it) => (
              <TitleCard
                key={`${it.provider}-${it.watchmodeTitleId}`}
                item={{
                  watchmodeTitleId: it.watchmodeTitleId,
                  title: it.title,
                  type: it.type,
                  poster: it.poster ?? null,
                  watchUrl: it.watchUrl ?? null,
                  provider: it.provider,
				  genres: it.genres,
				  genresStatus: it.genresStatus,
                }}
                onWatchUrlResolved={(url) => applyWatchUrl(it.provider, it.watchmodeTitleId, url)}
				onPosterClick={() => setModalItem(it)} // for row item

                action={savedItemActions(it)}
              />
            ))}
          </div>
        </div>

        {/* GENRE ROWS */}
        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          {loading ? (
            <div className="card muted">Loading…</div>
          ) : genreRows.length === 0 ? (
            <div className="card muted">No saved items yet.</div>
          ) : (
            genreRows.map(([genre, rowItems]) => {
              const isCollapsed = collapsed.has(genre);
              return (
                <div key={genre} className="wgRow">
                  <div className="wgRowHeader">
                    <div className="wgRowTitleWrap">
                      <div className="wgRowTitle">{genre}</div>
                      <div className="muted" style={{ fontWeight: 800 }}>
                        ({rowItems.length})
                      </div>
                    </div>

                    <button className="wgPillBtn" onClick={() => toggleGenreCollapse(genre)}>
                      {isCollapsed ? "▶ Expand" : "▼ Collapse"}
                    </button>
                  </div>

                  {isCollapsed ? (
                    <div className="muted">Row collapsed.</div>
                  ) : (
                    <div className="rail">
                      {rowItems.map((it) => (
                        <TitleCard
                          key={`${it.provider}-${it.watchmodeTitleId}`}
                          item={{
                            watchmodeTitleId: it.watchmodeTitleId,
                            title: it.title,
                            type: it.type,
                            poster: it.poster ?? null,
                            watchUrl: it.watchUrl ?? null,
                            provider: it.provider,
							genres: it.genres,
							genresStatus: it.genresStatus,
                          }}
                          onWatchUrlResolved={(url) => applyWatchUrl(it.provider, it.watchmodeTitleId, url)}
						  onPosterClick={() => setModalItem(it)} // for row item

                          action={savedItemActions(it)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
	  <TitleModal
  open={!!modalItem}
  item={
    modalItem
      ? {
          watchmodeTitleId: modalItem.watchmodeTitleId,
          title: modalItem.title,
          type: modalItem.type,
          poster: modalItem.poster,
          watchUrl: modalItem.watchUrl ?? null,
          provider: modalItem.provider,
          genres: modalItem.genres,
          genresStatus: modalItem.genresStatus,
        }
      : null
  }
  onClose={() => setModalItem(null)}
/>

    </>
  );
}
