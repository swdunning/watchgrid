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

export default function Home() {
  const nav = useNavigate();

  const [rows, setRows] = useState<HomeRow[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RowItem[]>([]);
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

  useEffect(() => {
    loadHome();
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    nav("/");
  };

  const runSearch = async () => {
    const term = q.trim();
    if (!term) return;

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
              placeholder="Search across your services…"
              onKeyDown={(e) => (e.key === "Enter" ? runSearch() : null)}
            />
            <button className="btn" onClick={runSearch} disabled={loadingSearch}>
              {loadingSearch ? "Searching…" : "Search"}
            </button>
          </div>

          {err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}

          {!!results.length && (
            <div style={{ marginTop: 16 }}>
              <div className="rowTitle">
                <h2 style={{ margin: 0 }}>Search results</h2>
                <div className="muted">Filtered to your services</div>
              </div>

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
            </div>
          )}
        </div>

        <div style={{ marginTop: 18 }}>
          {loadingHome ? (
            <div className="card muted">Loading your rows…</div>
          ) : (
            rows.map((row) => {
              const hasSaved = (row.savedItems?.length ?? 0) > 0;
              const items = hasSaved ? row.savedItems : row.popularItems;
              const title = hasSaved ? row.label : `Popular on ${row.label}`;

              return (
                <ProviderRow
                  key={row.provider}
                  title={title}
                  items={(items || []).map((x: any) => ({
                    watchmodeTitleId: x.watchmodeTitleId,
                    title: x.title,
                    type: x.type,
                    poster: x.poster ?? null,
                    watchUrl: x.watchUrl ?? null
                  }))}
                  onSeeAll={() => nav(`/app/provider/${row.provider}`)}
                  onRemove={
                    hasSaved
                      ? (id) => removeFromList(row.provider, id)
                      : undefined
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
