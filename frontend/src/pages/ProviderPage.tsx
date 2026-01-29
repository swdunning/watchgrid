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

type Row = {
  key: string;
  kind: string; // my_list | popular_tv | popular_movies | new | genre | genre_tv | genre_movies
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
  rows: Row[];
};

type Genre = { id: number; name: string };

function coerceGenres(payload: any): Genre[] {
  // Accept either:
  // 1) [ {id,name}, ... ]
  // 2) { genres: [ {id,name}, ... ] }
  const arr = Array.isArray(payload) ? payload : Array.isArray(payload?.genres) ? payload.genres : [];
  return arr
    .filter((g: any) => g && typeof g.id === "number" && typeof g.name === "string")
    .map((g: any) => ({ id: g.id, name: g.name }));
}

export default function ProviderPage() {
  const nav = useNavigate();
  const params = useParams();
  const provider = String(params.provider || "").toUpperCase();

  const [label, setLabel] = useState(provider);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Controls
  const [mode, setMode] = useState<"all" | "shows" | "movies">("all");
  const [genres, setGenres] = useState<Genre[]>([]);
  const [genreId, setGenreId] = useState<string>("all"); // "all" | "<id>"

  // Lazy-load genres flag (only used when genreId === "all")
  const [includeGenres, setIncludeGenres] = useState(false);
  const [loadingGenres, setLoadingGenres] = useState(false);

  const isSpecificGenre = genreId !== "all";

  // Track per-row pagination locally (so “Load more” appends)
  const rowState = useMemo(() => {
    const map = new Map<string, { page: number; canLoadMore: boolean; genreId?: number; kind: string }>();
    for (const r of rows) map.set(r.key, { page: r.page, canLoadMore: r.canLoadMore, genreId: r.genreId, kind: r.kind });
    return map;
  }, [rows]);

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
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load provider rows");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGenres();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When provider/mode/genre changes:
  // - If user selects a specific genre, we always do 3-row mode and disable includeGenres.
  useEffect(() => {
    if (isSpecificGenre) {
      setIncludeGenres(false);
    }
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, mode, genreId]);

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

  const loadMore = async (rowKey: string) => {
    const st = rowState.get(rowKey);
    if (!st || !st.canLoadMore) return;

    const nextPage = st.page + 1;

    const qs = new URLSearchParams();
    qs.set("kind", st.kind);
    qs.set("mode", mode);
    qs.set("page", String(nextPage));

    // genre row ids
    if (typeof st.genreId === "number") qs.set("genreId", String(st.genreId));
    if ((st.kind === "genre_tv" || st.kind === "genre_movies") && genreId !== "all") {
      qs.set("genreId", String(genreId));
    }

    const data = await api<{ page: number; canLoadMore: boolean; items: RowItem[] }>(
      `/api/provider/${provider}/browse?${qs.toString()}`
    );

    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== rowKey) return r;
        return {
          ...r,
          page: data.page,
          canLoadMore: data.canLoadMore,
          items: [...(r.items || []), ...(data.items || [])]
        };
      })
    );
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

  return (
    <>
      <Header
        left={
          <button className="btn secondary" onClick={() => nav("/app")} style={{ borderRadius: 12 }}>
            ← Back
          </button>
        }
      />

      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>{label}</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Browse curated rows for this service, or filter by TV/Movies and genre.
          </p>

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
                {(Array.isArray(genres) ? genres : []).map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isSpecificGenre && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
              <button className="btn secondary" onClick={onLoadGenres} disabled={includeGenres || loadingGenres}>
                {includeGenres ? "Genre rows loaded" : loadingGenres ? "Loading genre rows…" : "Load genre rows"}
              </button>
            </div>
          )}

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

              return (
                <div key={row.key} className="card">
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                    <h2 style={{ margin: 0 }}>{row.title}</h2>
                    <div className="muted" style={{ marginLeft: "auto" }}>
                      {row.items?.length ? `${row.items.length} items` : "No items"}
                    </div>
                  </div>

                  <div className="rail" style={{ marginTop: 12 }}>
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

                  {row.canLoadMore && row.kind !== "my_list" && (
                    <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                      <button className="btn secondary" onClick={() => loadMore(row.key)}>
                        Load more
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {!isSpecificGenre && !includeGenres && (
              <div className="card muted">
                Genre rows are available — click <b>Load genre rows</b> above to fetch Comedy/Drama/Sci-fi/Action/Mystery/Documentary.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
