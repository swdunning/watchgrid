// Home.tsx
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import ProviderRow from "../components/ProviderRow";
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
  const [popularRateLimitedProviders, setPopularRateLimitedProviders] = useState<string[]>([]);

  const [meta, setMeta] = useState<Record<string, ProviderMeta>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loadingHome, setLoadingHome] = useState(true);

	const [modalItem, setModalItem] = useState<RowItem | null>(null);


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
		rows: (HomeRow & { popularRateLimited?: boolean })[];
		masterSavedItems?: RowItem[];
		rateLimited?: boolean;
		popularRateLimitedProviders?: string[];
	}>("/api/home");


    setRows(data.rows || []);
	setMasterSavedItems(data.masterSavedItems || []);
	setRateLimited(!!data.rateLimited);
	setPopularRateLimitedProviders((data.popularRateLimitedProviders || []).map((p) => String(p).toUpperCase()));

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

  // ✅ Used to disable "+ Add" in Search when already saved
const savedKeySet = useMemo(() => {
  const s = new Set<string>();
  for (const it of masterSavedItems || []) {
    if (!it.provider) continue;
    s.add(`${String(it.provider).toUpperCase()}:${it.watchmodeTitleId}`);
  }
  return s;
}, [masterSavedItems]);

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

  // Teaching moment (React):
// useMemo caches a computed value between renders.
// Here, we compute a sorted display order for provider rows without mutating state.
const sortedProviderRows = useMemo(() => {
  const copy = [...(rows || [])];

  return copy.sort((a, b) => {
    const aHasSaved = (a.savedItems?.length ?? 0) > 0;
    const bHasSaved = (b.savedItems?.length ?? 0) > 0;

    // 1) rows with saved items come first
    if (aHasSaved !== bHasSaved) return aHasSaved ? -1 : 1;

    // 2) within each group, sort by provider label A→Z
    const aLabel = (a.label || a.provider || "").toLowerCase();
    const bLabel = (b.label || b.provider || "").toLowerCase();
    return aLabel.localeCompare(bLabel);
  });
}, [rows]);

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
		 <h1 className="h1 text home" style={{ marginBottom: 0 }}>All Your WatchGrid Lists In One Place</h1>
          <p className="p text home" style={{marginTop: 4, marginBottom: 30}}> Your lists by service — and popular picks to help you start.</p>
		  
        <div className="card">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <input
              className="inputSearch"
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

          {(rateLimited || popularRateLimitedProviders.length > 0) && (
  <div className="card" style={{ marginTop: 12, border: "1px solid rgba(255,91,122,0.35)" }}>
    <div style={{ color: "#ff5b7a", fontWeight: 600 }}>We’re temporarily rate-limited by Watchmode.</div>
    <div className="muted" style={{ marginTop: 4 }}>
      Some “Popular” rows may appear blank for ~30 seconds. Refresh after a moment.
    </div>

    {popularRateLimitedProviders.length > 0 ? (
      <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
        Affected: {popularRateLimitedProviders.join(", ")}
      </div>
    ) : null}
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
                   onWatchUrlResolved={(url) => {
					if (!url) return;
					patchWatchUrl(r.provider, r.watchmodeTitleId, url);
					}}
					onPosterClick={() => setModalItem(r)}

                    action={(() => {
  const p = r.provider ? String(r.provider).toUpperCase() : "";
  const alreadyAdded = !!r.provider && savedKeySet.has(`${p}:${r.watchmodeTitleId}`);

  return r.provider ? (
    <button
      className={`btn ${alreadyAdded ? "secondary" : ""}`}
      style={{ padding: "8px 10px", borderRadius: 10 }}
      onClick={() => addToList(r.provider!, r)}
      disabled={alreadyAdded}
      title={alreadyAdded ? "Already in your list" : "Add to your list"}
    >
      {alreadyAdded ? "Added" : "+ Add"}
    </button>
  ) : (
    <button className="btn secondary" style={{ padding: "8px 10px", borderRadius: 10 }} disabled>
      + Add
    </button>
  );
})()}

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
			<div style={{ display: "grid", gap: 16 }}>
				{/* All My Lists skeleton */}
				<div className="wgRow">
				<div className="wgRowHeader">
					<div className="wgRowTitleWrap">
					<div className="skel skelText" style={{ width: 180 }} />
					</div>
				</div>

				<div className="rail">
					{Array.from({ length: 6 }).map((_, i) => (
					<div key={i} className="skel skelPoster" />
					))}
				</div>
				</div>

				{/* Provider rows skeletons */}
				{Array.from({ length: 3 }).map((_, rowIdx) => (
				<div key={rowIdx} className="wgRow">
					<div className="wgRowHeader">
					<div className="wgRowTitleWrap">
						<div className="skel skelText" style={{ width: 220 }} />
					</div>
					<div className="skel skelBtn" style={{ width: 110 }} />
					</div>

					<div className="rail">
					{Array.from({ length: 6 }).map((_, i) => (
						<div key={i} className="skel skelPoster" />
					))}
					</div>
				</div>
				))}
			</div>
			) : (

            <>
              {masterSavedItems.length > 0 && (
				<div style={{ marginBottom: 16 }}>
					<ProviderRow
					title="All My Lists"
					logoUrl={null}
					items={masterSavedItems}
					onSeeAll={() => nav("/app/all")}
					variant="list"
					onPosterClick={(it) => setModalItem(it)}

					itemAction={(it) => (
						<button
						className="btn danger"
						style={{ padding: "8px 9px", borderRadius: 10 }}
						onClick={() => {
							if (!it.provider) return;
							removeFromList(it.provider, it.watchmodeTitleId);
						}}
						disabled={!it.provider}
						title={!it.provider ? "Missing provider" : "Remove from your list"}
						>
						– Remove
						</button>
					)}
					/>
				</div>
				)}


              {sortedProviderRows.map((row) => {
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
  onPosterClick={(it) => setModalItem(it)}
  itemAction={
    !hasSaved
      ? (it) => {
          // provider for this row (NETFLIX/HULU/etc)
          const p = String(row.provider).toUpperCase();

          // used to disable the button if already saved
          const key = `${p}:${it.watchmodeTitleId}`;
          const alreadyAdded = savedKeySet.has(key);

          return (
            <button
              className={`btn ${alreadyAdded ? "secondary" : ""}`}
              style={{ padding: "8px 10px", borderRadius: 10 }}
              onClick={(e) => {
                e.stopPropagation(); // ✅ prevents opening the modal when clicking +Add
                addToList(p, { ...it, provider: p });
              }}
              disabled={alreadyAdded}
              title={alreadyAdded ? "Already in your list" : "Add to your list"}
            >
              {alreadyAdded ? "Added" : "+ Add"}
            </button>
          );
        }
      : undefined
  }
/>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
	 
	{(() => {
  const modalProvider = modalItem?.provider ? String(modalItem.provider).toUpperCase() : "";
  const modalKey =
    modalItem?.watchmodeTitleId && modalProvider ? `${modalProvider}:${modalItem.watchmodeTitleId}` : "";
  const modalIsSaved = !!modalKey && savedKeySet.has(modalKey);

  return (
    <TitleModal
      open={!!modalItem}
      item={modalItem}
      onClose={() => setModalItem(null)}
      onAdd={
        modalItem && modalItem.provider && !modalIsSaved
          ? () => addToList(modalProvider, modalItem)
          : undefined
      }
      onRemove={
        modalItem && modalItem.provider && modalIsSaved
          ? () => {
              removeFromList(modalProvider, modalItem.watchmodeTitleId);
              setModalItem(null);
            }
          : undefined
      }
    />
  );
})()}



    </>
  );
}
