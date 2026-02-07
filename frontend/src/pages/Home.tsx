// Home.tsx
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
  const [masterSavedItems, setMasterSavedItems] = useState<RowItem[]>([]);
  const [rateLimited, setRateLimited] = useState(false);
  const [meta, setMeta] = useState<Record<string, ProviderMeta>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loadingHome, setLoadingHome] = useState(true);

  // Search
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RowItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const loadHome = async () => {
    setLoadingHome(true);
    setErr(null);
    try {
      const data = await api<{
        rows: HomeRow[];
        masterSavedItems?: RowItem[];
        rateLimited?: boolean;
      }>("/api/home");

      setRows(data.rows || []);
      setMasterSavedItems(data.masterSavedItems || []);
      setRateLimited(!!data.rateLimited);
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
        map[String(p.provider).toUpperCase()] = {
          provider: String(p.provider).toUpperCase(),
          label: p.label,
          logoUrl: p.logoUrl ?? null,
        };
      }
      setMeta(map);
    } catch {
      // optional
    }
  };

  useEffect(() => {
    loadHome();
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
      const data = await api<any[]>(`/api/search?q=${encodeURIComponent(term)}`);
      setResults(
        (data || []).map((r: any) => ({
          watchmodeTitleId: r.watchmodeTitleId,
          title: r.title,
          type: r.type,
          poster: r.poster ?? null,
          watchUrl: r.watchUrl ?? null,
          provider: r.provider,
        }))
      );
    } catch (e: any) {
      setErr(e?.message ?? "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  };

  // ✅ When a card resolves its URL, patch it in local state so it stays enabled
  const patchWatchUrl = (provider: string | undefined, watchmodeTitleId: number, watchUrl: string) => {
    if (!provider) return;

    setResults((prev) =>
      prev.map((x) => (x.provider === provider && x.watchmodeTitleId === watchmodeTitleId ? { ...x, watchUrl } : x))
    );

    setMasterSavedItems((prev) =>
      prev.map((x) => (x.provider === provider && x.watchmodeTitleId === watchmodeTitleId ? { ...x, watchUrl } : x))
    );

    setRows((prev) =>
      prev.map((row) => {
        if (row.provider !== provider) return row;
        return {
          ...row,
          savedItems: (row.savedItems || []).map((x) => (x.watchmodeTitleId === watchmodeTitleId ? { ...x, watchUrl } : x)),
          popularItems: (row.popularItems || []).map((x) => (x.watchmodeTitleId === watchmodeTitleId ? { ...x, watchUrl } : x)),
        };
      })
    );
  };

  /**
   * Optimistic add
   */
  const addToList = async (provider: string, item: RowItem) => {
    setErr(null);

    setRows((prev) =>
      prev.map((row) => {
        if (row.provider !== provider) return row;
        const exists = (row.savedItems || []).some((x) => x.watchmodeTitleId === item.watchmodeTitleId);
        if (exists) return row;
        return { ...row, savedItems: [{ ...item, provider }, ...(row.savedItems || [])] };
      })
    );

    setMasterSavedItems((prev) => {
      const exists = prev.some((x) => x.watchmodeTitleId === item.watchmodeTitleId && x.provider === provider);
      if (exists) return prev;
      return [{ ...item, provider }, ...prev];
    });

    try {
      await api("/api/lists/add", {
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
    } catch (e: any) {
      setRows((prev) =>
        prev.map((row) => {
          if (row.provider !== provider) return row;
          return {
            ...row,
            savedItems: (row.savedItems || []).filter((x) => x.watchmodeTitleId !== item.watchmodeTitleId),
          };
        })
      );
      setMasterSavedItems((prev) =>
        prev.filter((x) => !(x.watchmodeTitleId === item.watchmodeTitleId && x.provider === provider))
      );
      setErr(e?.message ?? "Failed to add");
    }
  };

  /**
   * Optimistic remove
   */
  const removeFromList = async (provider: string, watchmodeTitleId: number) => {
    setErr(null);

    const removedItem =
      rows.find((r) => r.provider === provider)?.savedItems?.find((x) => x.watchmodeTitleId === watchmodeTitleId) ?? null;

    setRows((prev) =>
      prev.map((row) => {
        if (row.provider !== provider) return row;
        return { ...row, savedItems: (row.savedItems || []).filter((x) => x.watchmodeTitleId !== watchmodeTitleId) };
      })
    );

    setMasterSavedItems((prev) =>
      prev.filter((x) => !(x.watchmodeTitleId === watchmodeTitleId && x.provider === provider))
    );

    try {
      await api("/api/lists/remove", {
        method: "POST",
        body: JSON.stringify({ provider, watchmodeTitleId }),
      });
    } catch (e: any) {
      if (removedItem) {
        setRows((prev) =>
          prev.map((row) => {
            if (row.provider !== provider) return row;
            const exists = (row.savedItems || []).some((x) => x.watchmodeTitleId === watchmodeTitleId);
            if (exists) return row;
            return { ...row, savedItems: [removedItem, ...(row.savedItems || [])] };
          })
        );
      }
      setErr(e?.message ?? "Failed to remove");
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    nav("/");
  };

  return (
    <>
      <Header
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => nav("/app/account")}>
              Account
            </button>
            <button className="btn secondary" onClick={logout}>
              Log out
            </button>
          </div>
        }
      />

      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Your WatchGrid</h1>
          <p className="muted">Your lists by service — and popular picks to help you start.</p>

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

          {rateLimited && (
            <div className="card" style={{ marginTop: 12, border: "1px solid rgba(255,91,122,0.35)" }}>
              <div style={{ color: "#ff5b7a", fontWeight: 600 }}>We’re temporarily rate-limited by Watchmode.</div>
              <div className="muted" style={{ marginTop: 4 }}>Some rows may load slowly. Try again in a few minutes.</div>
            </div>
          )}

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
                {results.map((r) => (
                  <TitleCard
                    key={`${r.provider ?? "X"}-${r.watchmodeTitleId}`}
                    item={r}
                    onWatchUrlResolved={(id, url) => patchWatchUrl(r.provider, id, url)}
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
                        <button className="btn secondary" style={{ padding: "8px 10px", borderRadius: 10 }} disabled>
                          + Add
                        </button>
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="card muted">
                {q.trim() ? "No results found for your selected services." : "Start typing a title, then press Enter."}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          {loadingHome ? (
            <div className="card muted">Loading your rows…</div>
          ) : (
            <>
              {masterSavedItems.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <ProviderRow title="All My Lists" logoUrl={null} items={masterSavedItems} onSeeAll={() => nav("/app/all")} />
                </div>
              )}

              {rows.map((row) => {
                const pKey = String(row.provider).toUpperCase();
                const hasSaved = (row.savedItems?.length ?? 0) > 0;

                const items = hasSaved ? row.savedItems : row.popularItems;
                const title = hasSaved ? `My List – ${row.label}` : `Popular on ${row.label}`;
                const hint = hasSaved ? "" : "Click to add items to your list";
                const logoUrl = meta[pKey]?.logoUrl ?? null;

                return (
                  <div key={row.provider} style={{ marginBottom: 16 }}>
                    {!hasSaved && (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                        <span className="muted" style={{ fontSize: 13 }}>{hint}</span>
                      </div>
                    )}

                    <div style={{ opacity: hasSaved ? 1 : 0.86 }}>
                      <ProviderRow
                        title={title}
                        logoUrl={logoUrl}
                        items={items}
                        onSeeAll={() => nav(`/app/provider/${row.provider}`)}
                        onRemove={hasSaved ? (id) => removeFromList(row.provider, id) : undefined}
                        variant={hasSaved ? "list" : "suggested"}
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </>
  );
}
