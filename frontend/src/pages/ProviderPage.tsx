import { useEffect, useMemo, useRef, useState } from "react";
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

type Row = {
  key: string;
  kind: string;
  title: string;
  items: RowItem[];
  page: number;
  canLoadMore: boolean;
  genreId?: number;
};

type ProviderRowsResponse = {
  provider: string;
  label: string;
  mode: "all" | "shows" | "movies";
  genreId: number | null;
  includeGenres?: boolean;
  rateLimited?: boolean;
  rows: Row[];
};

type Genre = { id: number; name: string };

function coerceGenres(payload: any): Genre[] {
  const arr = Array.isArray(payload) ? payload : Array.isArray(payload?.genres) ? payload.genres : [];
  return arr
    .filter((g: any) => g && typeof g.id === "number" && typeof g.name === "string")
    .map((g: any) => ({ id: g.id, name: g.name }));
}

function isNearRightEdge(el: HTMLDivElement, px = 48) {
  return el.scrollLeft + el.clientWidth >= el.scrollWidth - px;
}

function computeRailUi(el: HTMLDivElement | null) {
  if (!el) return { atStart: true, atEnd: true };
  // If content doesn't overflow, treat as both-start/end.
  const noOverflow = el.scrollWidth <= el.clientWidth + 2;
  if (noOverflow) return { atStart: true, atEnd: true };
  return {
    atStart: el.scrollLeft <= 1,
    atEnd: isNearRightEdge(el)
  };
}

export default function ProviderPage() {
  const nav = useNavigate();
  const params = useParams();
  const provider = String(params.provider || "").toUpperCase();

  const [label, setLabel] = useState(provider);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  // Controls
  const [mode, setMode] = useState<"all" | "shows" | "movies">("all");
  const [genres, setGenres] = useState<Genre[]>([]);
  const [genreId, setGenreId] = useState<string>("all");

  const [includeGenres, setIncludeGenres] = useState(false);
  const [loadingGenres, setLoadingGenres] = useState(false);

  const isSpecificGenre = genreId !== "all";

  // Row paging state
  const rowState = useMemo(() => {
    const map = new Map<string, { page: number; canLoadMore: boolean; genreId?: number; kind: string }>();
    for (const r of rows) map.set(r.key, { page: r.page, canLoadMore: r.canLoadMore, genreId: r.genreId, kind: r.kind });
    return map;
  }, [rows]);

  // Refs + UI state
  const railRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [rowUi, setRowUi] = useState<Record<string, { atStart: boolean; atEnd: boolean }>>({});
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});
  const rafIds = useRef<Record<string, number | null>>({});

  const setRailRef = (rowKey: string) => (el: HTMLDivElement | null) => {
    railRefs.current[rowKey] = el;
  };

  const setRowUiIfChanged = (rowKey: string, next: { atStart: boolean; atEnd: boolean }) => {
    setRowUi((prev) => {
      const cur = prev[rowKey];
      if (cur && cur.atStart === next.atStart && cur.atEnd === next.atEnd) return prev;
      return { ...prev, [rowKey]: next };
    });
  };

  const updateRailUi = (rowKey: string) => {
    const el = railRefs.current[rowKey];
    setRowUiIfChanged(rowKey, computeRailUi(el));
  };

  const onRailScroll = (rowKey: string) => {
    if (rafIds.current[rowKey]) return;
    rafIds.current[rowKey] = requestAnimationFrame(() => {
      rafIds.current[rowKey] = null;
      updateRailUi(rowKey);
    });
  };

  const loadGenres = async () => {
    try {
      const payload = await api<any>("/api/genres");
      setGenres(coerceGenres(payload));
    } catch {
      setGenres([]);
    }
  };

  const loadRows = async (opts?: { forceIncludeGenres?: boolean }) => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      qs.set("mode", mode);
      qs.set("genreId", genreId);

      const wantGenres = (opts?.forceIncludeGenres ?? includeGenres) && !isSpecificGenre;
      if (wantGenres) qs.set("includeGenres", "1");

      const data = await api<ProviderRowsResponse>(`/api/provider/${provider}/rows?${qs.toString()}`);
      setLabel(data.label || provider);
      setRows(data.rows || []);
      setRateLimited(!!data.rateLimited);

      setRowUi({});
      setLoadingMore({});
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load provider rows");
      setRows([]);
      setRateLimited(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGenres();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isSpecificGenre) setIncludeGenres(false);
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, mode, genreId]);

  // After rows render, initialize arrow states & re-check on resize
  useEffect(() => {
    const init = () => {
      for (const r of rows) updateRailUi(r.key);
    };
    const t = setTimeout(init, 0);

    const onResize = () => init();
    window.addEventListener("resize", onResize);

    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const addToList = async (item: RowItem) => {
    await api("/api/lists/add", {
      method: "POST",
      body: JSON.stringify({
        provider,
        watchmodeTitleId: item.watchmodeTitleId,
        title: item.title,
        type: item.type,
        poster: item.poster,
        watchUrl: item.watchUrl ?? null
      })
    });
    await loadRows();
  };

  const removeFromList = async (watchmodeTitleId: number) => {
    await api("/api/lists/remove", {
      method: "POST",
      body: JSON.stringify({ provider, watchmodeTitleId })
    });
    await loadRows();
  };

  const loadMoreForRow = async (rowKey: string) => {
    const st = rowState.get(rowKey);
    if (!st || !st.canLoadMore) return;

    setLoadingMore((prev) => ({ ...prev, [rowKey]: true }));
    try {
      const nextPage = st.page + 1;

      const qs = new URLSearchParams();
      qs.set("kind", st.kind);
      qs.set("mode", mode);
      qs.set("page", String(nextPage));

      if (typeof st.genreId === "number") qs.set("genreId", String(st.genreId));
      if ((st.kind === "genre_tv" || st.kind === "genre_movies") && genreId !== "all") {
        qs.set("genreId", String(genreId));
      }

      const data = await api<{ page: number; canLoadMore: boolean; items: RowItem[] }>(
        `/api/provider/${provider}/browse?${qs.toString()}`
      );

      setRows((prev) =>
        prev.map((r) =>
          r.key !== rowKey
            ? r
            : { ...r, page: data.page, canLoadMore: data.canLoadMore, items: [...(r.items || []), ...(data.items || [])] }
        )
      );

      // scroll into appended content
      setTimeout(() => {
        const el = railRefs.current[rowKey];
        if (!el) return;
        const step = Math.floor(el.clientWidth * 0.85);
        el.scrollBy({ left: step, behavior: "smooth" });
        setTimeout(() => updateRailUi(rowKey), 200);
      }, 0);
    } finally {
      setLoadingMore((prev) => ({ ...prev, [rowKey]: false }));
    }
  };

  const scrollLeft = (rowKey: string) => {
    const el = railRefs.current[rowKey];
    if (!el) return;
    const step = Math.floor(el.clientWidth * 0.85);
    el.scrollBy({ left: -step, behavior: "smooth" });
    setTimeout(() => updateRailUi(rowKey), 200);
  };

  const scrollRight = async (rowKey: string) => {
    const el = railRefs.current[rowKey];
    if (!el) return;

    const st = rowState.get(rowKey);
    const atEnd = isNearRightEdge(el);

    if (atEnd && st?.canLoadMore && !loadingMore[rowKey]) {
      await loadMoreForRow(rowKey);
      return;
    }

    const step = Math.floor(el.clientWidth * 0.85);
    el.scrollBy({ left: step, behavior: "smooth" });
    setTimeout(() => updateRailUi(rowKey), 200);
  };

  const onLoadGenres = async () => {
    if (isSpecificGenre) return;
    setLoadingGenres(true);
    try {
      setIncludeGenres(true);
      await loadRows({ forceIncludeGenres: true });
    } finally {
      setLoadingGenres(false);
    }
  };

  const ToggleBtn = ({ value, text }: { value: "all" | "shows" | "movies"; text: string }) => (
    <button
      className={`btn ${mode === value ? "" : "secondary"}`}
      onClick={() => setMode(value)}
      style={{ borderRadius: 999, padding: "8px 12px" }}
      type="button"
    >
      {text}
    </button>
  );

  const ArrowBtn = ({
    dir,
    disabled,
    onClick,
    ariaLabel
  }: {
    dir: "left" | "right";
    disabled?: boolean;
    onClick: () => void;
    ariaLabel: string;
  }) => {
    // IMPORTANT: show even when disabled (just dim), so user always sees both arrows.
    const base: React.CSSProperties = {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 54,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "none",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.35 : 1,
      pointerEvents: disabled ? "none" : "auto",
      transition: "opacity 180ms ease",
      background:
  dir === "left"
    ? "linear-gradient(90deg, rgba(123,47,247,0.35), rgba(0,0,0,0))"
    : "linear-gradient(270deg, rgba(123,47,247,0.35), rgba(0,0,0,0))"

    };

    const iconBox: React.CSSProperties = {
      height: 36,
      width: 36,
      borderRadius: 999,
	  background: "rgba(123,47,247,0.55)",	
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 18,
	  border: "2px solid rgba(230,220,255,0.95)",
	  color: "rgba(230,220,255,0.95)",

    };

    return (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        disabled={disabled}
        style={{
          ...base,
          left: dir === "left" ? 0 : undefined,
          right: dir === "right" ? 0 : undefined
        }}
      >
        <div style={iconBox}>{dir === "left" ? "‹" : "›"}</div>
      </button>
    );
  };

  return (
    <>
      <Header />

      <div className="page">
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button className="btn secondary" onClick={() => nav("/app")} style={{ borderRadius: 12 }}>
            ← Back to Home
          </button>
        </div>

        <div className="card">
          <h1 style={{ marginTop: 0 }}>{label}</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Browse curated rows for this service, or filter by TV/Movies and genre.
          </p>

          {rateLimited && (
            <div className="card" style={{ marginTop: 12, border: "1px solid rgba(255,91,122,0.35)" }}>
              <div style={{ color: "#ff5b7a", fontWeight: 600 }}>We’re temporarily rate-limited by Watchmode.</div>
              <div className="muted" style={{ marginTop: 4 }}>Try again in a few minutes.</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <ToggleBtn value="all" text="TV Shows & Movies" />
              <ToggleBtn value="shows" text="TV Shows" />
              <ToggleBtn value="movies" text="Movies" />
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <div className="muted">Genre</div>
              <select
                className="input"
                style={{ width: 260 }}
                value={genreId}
                onChange={(e) => setGenreId(e.target.value)}
              >
                <option value="all">All genres</option>
                {genres.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}
        </div>

        {loading ? (
          <div className="card muted" style={{ marginTop: 14 }}>
            Loading rows…
          </div>
        ) : (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            {rows.map((row) => {
              const isMyList = row.kind === "my_list";
              const ui = rowUi[row.key] || { atStart: true, atEnd: false };
              const canLoadMore = row.canLoadMore && !isMyList;

              return (
                <div key={row.key} className="card">
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                    <h2 style={{ margin: 0 }}>{row.title}</h2>
                    <div className="muted" style={{ marginLeft: "auto" }}>
                      {row.items?.length ? `${row.items.length} items` : "No items"}
                    </div>
                  </div>

                  {/* ✅ FIX: clamp the rail to the card width so it never grows the page */}
                  <div
                    style={{
                      position: "relative",
                      marginTop: 12,
                      width: "100%",
                      maxWidth: "100%",
                      minWidth: 0,
                      overflow: "hidden" // critical: prevents whole-page horizontal growth
                    }}
                  >
                    <ArrowBtn dir="left" ariaLabel="Scroll left" disabled={ui.atStart} onClick={() => scrollLeft(row.key)} />

                    <div
                      ref={setRailRef(row.key)}
                      onScroll={() => onRailScroll(row.key)}
                      style={{
                        width: "100%",
                        maxWidth: "100%",
                        minWidth: 0,
                        overflowX: "auto",
                        overflowY: "hidden",
                        padding: "6px 56px", // space for arrows
                        WebkitOverflowScrolling: "touch"
                      }}
                    >
                      {/* ✅ FIX: use flex (not inline-flex + nowrap) */}
                      <div style={{ display: "flex", gap: 12, alignItems: "stretch", width: "max-content" }}>
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

                    <ArrowBtn
                      dir="right"
                      ariaLabel="Scroll right"
                      disabled={(!canLoadMore && ui.atEnd) || !!loadingMore[row.key]}
                      onClick={() => scrollRight(row.key)}
                    />

                    {!!loadingMore[row.key] && (
                      <div
                        style={{
                          position: "absolute",
                          right: 64,
                          top: 10,
                          padding: "6px 10px",
                          borderRadius: 999,
                          background: "rgba(20,20,28,0.85)",
                          border: "1px solid rgba(255,255,255,0.12)"
                        }}
                        className="muted"
                      >
                        Loading…
                      </div>
                    )}
                  </div>

                  {canLoadMore && ui.atEnd && !loadingMore[row.key] && (
                    <div className="muted" style={{ marginTop: 8 }}>
                      Tip: press the right arrow again to load more.
                    </div>
                  )}
                </div>
              );
            })}

            {!isSpecificGenre && !includeGenres && (
              <div className="card muted">
                <div style={{ marginBottom: 10 }}>
                  Genre rows are available — click <b>Load genre rows</b> to fetch Comedy/Drama/Sci-fi/Action/Mystery/Documentary.
                </div>
                <button className="btn secondary" onClick={onLoadGenres} disabled={includeGenres || loadingGenres}>
                  {includeGenres ? "Genre rows loaded" : loadingGenres ? "Loading genre rows…" : "Load genre rows"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
