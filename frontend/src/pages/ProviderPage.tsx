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

type Genre = { id: number; name: string };

export default function ProviderPage() {
  const nav = useNavigate();
  const { provider } = useParams();
  const providerKey = useMemo(() => String(provider || "").toUpperCase(), [provider]);

  const [label, setLabel] = useState(providerKey);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [genres, setGenres] = useState<Genre[]>([]);
  const [genreId, setGenreId] = useState<number | "all">("all");

  const [saved, setSaved] = useState<Item[]>([]);
  const [browseTab, setBrowseTab] = useState<"popular" | "new">("popular");
  const [browseItems, setBrowseItems] = useState<Item[]>([]);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[]>([]);

  const [err, setErr] = useState<string | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const loadMeta = async () => {
    const data = await api<{ providers: { provider: string; label: string; logoUrl: string | null }[] }>(
      "/api/meta/providers"
    );
    const m = (data.providers || []).find((p) => p.provider === providerKey);
    if (m) {
      setLabel(m.label);
      setLogoUrl(m.logoUrl);
    } else {
      setLabel(providerKey);
      setLogoUrl(null);
    }
  };

  const loadGenres = async () => {
    const data = await api<{ genres: Genre[] }>("/api/genres");
    setGenres(data.genres || []);
  };

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
  };

  const loadBrowse = async (tab: "popular" | "new", g: number | "all") => {
    setLoadingBrowse(true);
    setErr(null);
    try {
      const genreParam = g === "all" ? "" : `&genreId=${encodeURIComponent(String(g))}`;
      const data = await api<{ items: any[] }>(
        `/api/provider/${providerKey}/browse?tab=${encodeURIComponent(tab)}${genreParam}`
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
        await Promise.all([loadMeta(), loadGenres(), loadProviderSaved()]);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load provider page");
      }
      // Always load Popular first
      setBrowseTab("popular");
      setGenreId("all");
      await loadBrowse("popular", "all");
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  objectFit: "contain",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  padding: 6
                }}
              />
            ) : (
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.10)"
                }}
              />
            )}

            <div>
              <h1 style={{ margin: 0 }}>{label}</h1>
              <div className="muted">Browse by Popular/New + Genre, or search within {label}.</div>
            </div>
          </div>

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

          {/* Tabs + Genre */}
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className={`btn ${browseTab === "popular" ? "" : "secondary"}`}
              onClick={async () => {
                setBrowseTab("popular");
                await loadBrowse("popular", genreId);
              }}
            >
              Popular
            </button>

            <button
              className={`btn ${browseTab === "new" ? "" : "secondary"}`}
              onClick={async () => {
                setBrowseTab("new");
                await loadBrowse("new", genreId);
              }}
            >
              New
            </button>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginLeft: 8 }}>
              <div className="muted">Genre</div>
              <select
                className="input"
                style={{ width: 260 }}
                value={genreId}
                onChange={async (e) => {
                  const v = e.target.value === "all" ? "all" : Number(e.target.value);
                  setGenreId(v as any);
                  await loadBrowse(browseTab, v as any);
                }}
              >
                <option value="all">All genres</option>
                {genres.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}
        </div>

        {/* Browse rail */}
        <div style={{ marginTop: 18 }}>
          <div className="rowTitle">
            <h2 style={{ margin: 0 }}>
              {browseTab === "popular" ? `Popular on ${label}` : `New on ${label}`}
              {genreId !== "all" ? ` • ${genres.find((g) => g.id === genreId)?.name ?? ""}` : ""}
            </h2>
            <div className="muted">{loadingBrowse ? "Loading…" : "Browse"}</div>
          </div>

          <div className="rail">
            {browseItems.map((b) => {
              const isSaved = savedIds.has(b.watchmodeTitleId);
              return (
                <TitleCard
                  key={b.watchmodeTitleId}
                  item={{ ...b, provider: providerKey }}
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
                item={{ ...s, provider: providerKey }}
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
                    item={{ ...r, provider: providerKey }}
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
