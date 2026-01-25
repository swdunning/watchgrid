import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import ProviderRow from "../components/ProviderRow";
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

type HomeRow = {
  provider: string;
  label: string;
  savedItems: RowItem[];
  popularItems: RowItem[];
};

type ProviderMeta = {
  provider: string;
  label: string;
  logoUrl: string | null;
};

export default function Home() {
  const nav = useNavigate();

  const [rows, setRows] = useState<HomeRow[]>([]);
  const [meta, setMeta] = useState<Record<string, ProviderMeta>>({});

  // Search state
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RowItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingHome, setLoadingHome] = useState(true);

  const loadHome = async () => {
    setLoadingHome(true);
    setErr(null);
    try {
      const data = await api<{ rows: HomeRow[] }>("/api/home");
      setRows(data.rows || []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load home");
    } finally {
      setLoadingHome(false);
    }
  };

  const loadProviderMeta = async () => {
    try {
      const data = await api<{ providers: ProviderMeta[] }>("/api/meta/providers");
      const map: Record<string, ProviderMeta> = {};
      for (const p of data.providers || []) {
        map[p.provider] = p;
      }
      setMeta(map);
    } catch {
      // Meta is optional; don't block the page
    }
  };

  useEffect(() => {
    loadHome();
    loadProviderMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Option A: if query is cleared, clear results immediately
  useEffect(() => {
    if (q.trim() === "") {
      setResults([]);
    }
  }, [q]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQ("");
    setResults([]);
    setErr(null);
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    nav("/");
  };

  const runSearch = async () => {
    const term = q.trim();

    // Option B: if user hits Enter with empty query, close + clear
    if (!term) {
      setResults([]);
      setSearchOpen(false);
      return;
    }

    setLoadingSearch(true);
    setErr(null);
    setResults([]);

    try {
      const data = await api<any[]>(`/api/search?q=${encodeURIComponent(term)}`);

      setResults(
        (data || []).map((r: any) => ({
          watchmodeTitleId: r.watchmodeTitleId,
          title: r.title,
          type: r.type,
          poster: r.poster ?? null,
          watchUrl: r.watchUrl ?? null,
          provider: r.provider
        }))
      );
    } catch (e: any) {
      setErr(e?.message ?? "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  };

  const addToList = async (provider: string, item: RowItem) => {
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
    await loadHome();
  };

  const removeFromList = async (provider: string, watchmodeTitleId: number) => {
    await api("/api/lists/remove", {
      method: "POST",
      body: JSON.stringify({ provider, watchmodeTitleId })
    });
    await loadHome();
  };

  return (
    <>
      <Header
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={logout}>
              Log out
            </button>
          </div>
        }
      />

      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Your WatchGrid</h1>
          <p className="muted">
            Browse your provider rows, or search across only the services you selected.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <input
              className="input"
              style={{ maxWidth: 560 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search across your services…"
              onKeyDown={(e) => (e.key === "Enter" ? runSearch() : null)}
            />
            <button className="btn" onClick={runSearch} disabled={loadingSearch}>
              {loadingSearch ? "Searching…" : "Search"}
            </button>
          </div>

          {err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}

          {/* Netflix-style animated search rail */}
          <div className={`searchPanel ${searchOpen ? "open" : ""}`}>
            <div className="searchPanelHeader">
              <div className="searchPanelTitle">
                <h2 style={{ margin: 0 }}>Search</h2>
                <div className="muted">
                  {q.trim() ? `Results for “${q.trim()}”` : "Type to search…"}
                </div>
              </div>

              <button className="searchCloseBtn" onClick={closeSearch} aria-label="Close search">
                ✕
              </button>
            </div>

            {!!results.length ? (
              <div className="rail">
                {results.map((r) => (
                  <TitleCard
                    key={`${r.provider ?? "X"}-${r.watchmodeTitleId}`}
                    item={{
                      watchmodeTitleId: r.watchmodeTitleId,
                      title: r.title,
                      type: r.type,
                      poster: r.poster,
                      watchUrl: r.watchUrl,
                      provider: r.provider
                    }}
                    action={
                      r.provider ? (
                        <button
                          className="btn"
                          style={{ padding: "8px 10px", borderRadius: 10 }}
                          onClick={() => addToList(r.provider!, r)}
                        >
                          + Add
                        </button>
                      ) : (
                        <button
                          className="btn secondary"
                          style={{ padding: "8px 10px", borderRadius: 10 }}
                          disabled
                        >
                          + Add
                        </button>
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="card muted">
                {q.trim()
                  ? "No results found for your selected services."
                  : "Start typing a title, then press Enter."}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          {loadingHome ? (
            <div className="card muted">Loading your rows…</div>
          ) : (
            rows.map((row) => {
              const hasSaved = (row.savedItems?.length ?? 0) > 0;
              const items = hasSaved ? row.savedItems : row.popularItems;
              const title = hasSaved ? row.label : `Popular on ${row.label}`;
              const logoUrl = meta[row.provider]?.logoUrl ?? null;

              return (
                <ProviderRow
                  key={row.provider}
                  title={title}
                  logoUrl={logoUrl}
                  items={(items || []).map((x: any) => ({
                    watchmodeTitleId: x.watchmodeTitleId,
                    title: x.title,
                    type: x.type,
                    poster: x.poster ?? null,
                    watchUrl: x.watchUrl ?? null
                  }))}
                  onSeeAll={() => nav(`/app/provider/${row.provider}`)}
                  onRemove={
                    hasSaved ? (id) => removeFromList(row.provider, id) : undefined
                  }
                />
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
