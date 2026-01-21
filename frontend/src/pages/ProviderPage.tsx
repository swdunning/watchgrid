import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import TitleCard from "../components/TitleCard";
import { api } from "../api/client";

type Item = {
  watchmodeTitleId: number;
  title: string;
  type: string;
  poster: string | null;
  watchUrl?: string | null;
  provider?: string;
};

export default function ProviderPage() {
  const nav = useNavigate();
  const { provider } = useParams();

  const providerKey = useMemo(() => String(provider || "").toUpperCase(), [provider]);

  const [label, setLabel] = useState(providerKey);

  const [saved, setSaved] = useState<Item[]>([]);
  const [browseTab, setBrowseTab] = useState<"popular" | "new">("popular");
  const [browseItems, setBrowseItems] = useState<Item[]>([]);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[]>([]);

  const [err, setErr] = useState<string | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const loadProviderSaved = async () => {
    const data = await api<{ provider: string; items: any[] }>(`/api/provider/${providerKey}`);
    setSaved(
      (data.items || []).map((x: any) => ({
        watchmodeTitleId: x.watchmodeTitleId,
        title: x.title,
        type: x.type,
        poster: x.poster ?? null,
        watchUrl: x.watchUrl ?? null,
        provider: providerKey
      }))
    );
    setLabel(providerKey);
  };

  const loadBrowse = async (tab: "popular" | "new") => {
    setLoadingBrowse(true);
    setErr(null);
    try {
      const data = await api<{ items: any[] }>(
        `/api/provider/${providerKey}/browse?tab=${encodeURIComponent(tab)}`
      );
      setBrowseItems(
        (data.items || []).map((x: any) => ({
          watchmodeTitleId: x.watchmodeTitleId,
          title: x.title,
          type: x.type,
          poster: x.poster ?? null,
          watchUrl: x.watchUrl ?? null,
          provider: providerKey
        }))
      );
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load browse");
    } finally {
      setLoadingBrowse(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await loadProviderSaved();
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load provider");
      }
      // Always load Popular first so it's never blank
      await loadBrowse("popular");
      setBrowseTab("popular");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKey]);

  const runProviderSearch = async () => {
    const term = q.trim();
    if (!term) return;

    setLoadingSearch(true);
    setErr(null);
    setResults([]);

    try {
      const data = await api<any[]>(
        `/api/search?q=${encodeURIComponent(term)}&provider=${encodeURIComponent(providerKey)}`
      );
      setResults(
        (data || []).map((r: any) => ({
          watchmodeTitleId: r.watchmodeTitleId,
          title: r.title,
          type: r.type,
          poster: r.poster ?? null,
          watchUrl: r.watchUrl ?? null,
          provider: providerKey
        }))
      );
    } catch (e: any) {
      setErr(e?.message ?? "Search failed");
    } finally {
      setLoadingSearch(false);
    }
  };

  const add = async (item: Item) => {
    await api("/api/lists/add", {
      method: "POST",
      body: JSON.stringify({
        provider: providerKey,
        watchmodeTitleId: item.watchmodeTitleId,
        title: item.title,
        type: item.type,
        poster: item.poster,
        watchUrl: item.watchUrl
      })
    });
    await loadProviderSaved();
  };

  const remove = async (watchmodeTitleId: number) => {
    await api("/api/lists/remove", {
      method: "POST",
      body: JSON.stringify({ provider: providerKey, watchmodeTitleId })
    });
    await loadProviderSaved();
  };

  const savedIds = useMemo(() => new Set(saved.map((s) => s.watchmodeTitleId)), [saved]);

  return (
    <>
      <Header
        right={
          <button className="btn secondary" onClick={() => nav("/app")}>
            ← Back
          </button>
        }
      />

      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>{label}</h1>
          <p className="muted">
            Browse Popular/New, search within {label}, and add titles to this provider list.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <input
              className="input"
              style={{ maxWidth: 560 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${label}…`}
              onKeyDown={(e) => (e.key === "Enter" ? runProviderSearch() : null)}
            />
            <button className="btn" onClick={runProviderSearch} disabled={loadingSearch}>
              {loadingSearch ? "Searching…" : "Search"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              className={`btn ${browseTab === "popular" ? "" : "secondary"}`}
              onClick={async () => {
                setBrowseTab("popular");
                await loadBrowse("popular");
              }}
              disabled={loadingBrowse && browseTab === "popular"}
            >
              Popular
            </button>
            <button
              className={`btn ${browseTab === "new" ? "" : "secondary"}`}
              onClick={async () => {
                setBrowseTab("new");
                await loadBrowse("new");
              }}
              disabled={loadingBrowse && browseTab === "new"}
            >
              New
            </button>
          </div>

          {err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}
        </div>

        {/* Browse rail (never blank) */}
        <div style={{ marginTop: 18 }}>
          <div className="rowTitle">
            <h2 style={{ margin: 0 }}>
              {browseTab === "popular" ? `Popular on ${label}` : `New on ${label}`}
            </h2>
            <div className="muted">{loadingBrowse ? "Loading…" : "Browse"}</div>
          </div>

          <div className="rail">
            {browseItems.map((b) => {
              const isSaved = savedIds.has(b.watchmodeTitleId);
              return (
                <TitleCard
                  key={b.watchmodeTitleId}
                  item={{
                    watchmodeTitleId: b.watchmodeTitleId,
                    title: b.title,
                    type: b.type,
                    poster: b.poster,
                    watchUrl: b.watchUrl,
                    provider: providerKey
                  }}
                  action={
                    isSaved ? (
                      <button
                        className="btn secondary"
                        style={{ padding: "8px 10px", borderRadius: 10 }}
                        onClick={() => remove(b.watchmodeTitleId)}
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        className="btn"
                        style={{ padding: "8px 10px", borderRadius: 10 }}
                        onClick={() => add(b)}
                      >
                        + Add
                      </button>
                    )
                  }
                />
              );
            })}
          </div>
        </div>

        {/* Saved rail */}
        <div style={{ marginTop: 18 }}>
          <div className="rowTitle">
            <h2 style={{ margin: 0 }}>Your saved {label} list</h2>
            <div className="muted">{saved.length} saved</div>
          </div>

          <div className="rail">
            {saved.map((s) => (
              <TitleCard
                key={s.watchmodeTitleId}
                item={{
                  watchmodeTitleId: s.watchmodeTitleId,
                  title: s.title,
                  type: s.type,
                  poster: s.poster,
                  watchUrl: s.watchUrl,
                  provider: providerKey
                }}
                action={
                  <button
                    className="btn secondary"
                    style={{ padding: "8px 10px", borderRadius: 10 }}
                    onClick={() => remove(s.watchmodeTitleId)}
                  >
                    Remove
                  </button>
                }
              />
            ))}
          </div>
        </div>

        {/* Provider-restricted search results */}
        {!!results.length && (
          <div style={{ marginTop: 18 }}>
            <div className="rowTitle">
              <h2 style={{ margin: 0 }}>Search results</h2>
              <div className="muted">Restricted to {label}</div>
            </div>

            <div className="rail">
              {results.map((r) => {
                const isSaved = savedIds.has(r.watchmodeTitleId);
                return (
                  <TitleCard
                    key={r.watchmodeTitleId}
                    item={{
                      watchmodeTitleId: r.watchmodeTitleId,
                      title: r.title,
                      type: r.type,
                      poster: r.poster,
                      watchUrl: r.watchUrl,
                      provider: providerKey
                    }}
                    action={
                      isSaved ? (
                        <button
                          className="btn secondary"
                          style={{ padding: "8px 10px", borderRadius: 10 }}
                          onClick={() => remove(r.watchmodeTitleId)}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          className="btn"
                          style={{ padding: "8px 10px", borderRadius: 10 }}
                          onClick={() => add(r)}
                        >
                          + Add
                        </button>
                      )
                    }
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
