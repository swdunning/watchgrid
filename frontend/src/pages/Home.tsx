import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import ProviderRow from "../components/ProviderRow";
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
  const [masterSavedItems, setMasterSavedItems] = useState<RowItem[]>([]);
  const [rateLimited, setRateLimited] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadingHome, setLoadingHome] = useState(true);

  const loadHome = async () => {
    setLoadingHome(true);
    setErr(null);
    try {
      const data = await api<{ rows: HomeRow[]; masterSavedItems?: RowItem[]; rateLimited?: boolean }>("/api/home");
      setRows(data.rows || []);
      setMasterSavedItems(data.masterSavedItems || []);
      setRateLimited(!!data.rateLimited);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load home");
    } finally {
      setLoadingHome(false);
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    nav("/");
  };

  useEffect(() => {
    loadHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

          {rateLimited && (
            <div className="card" style={{ marginTop: 12, border: "1px solid rgba(255,91,122,0.35)" }}>
              <div style={{ color: "#ff5b7a", fontWeight: 600 }}>We’re temporarily rate-limited by Watchmode.</div>
              <div className="muted" style={{ marginTop: 4 }}>Some rows may load slowly. Try again in a few minutes.</div>
            </div>
          )}

          {err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}
        </div>

        <div style={{ marginTop: 18 }}>
          {loadingHome ? (
            <div className="card muted">Loading your rows…</div>
          ) : (
            <>
              {masterSavedItems.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <ProviderRow
                    title="All My Lists"
                    items={masterSavedItems.map((x: any) => ({
                      watchmodeTitleId: x.watchmodeTitleId,
                      title: x.title,
                      type: x.type,
                      poster: x.poster ?? null,
                      watchUrl: x.watchUrl ?? null
                    }))}
                    onSeeAll={() => nav(`/app`)}
                  />
                </div>
              )}

              {rows.map((row) => {
                const hasSaved = (row.savedItems?.length ?? 0) > 0;
                const items = hasSaved ? row.savedItems : row.popularItems;

                const title = hasSaved ? `My List – ${row.label}` : `Popular on ${row.label}`;
                const hint = hasSaved ? "" : "Click to add items to your list";

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
                        items={(items || []).map((x: any) => ({
                          watchmodeTitleId: x.watchmodeTitleId,
                          title: x.title,
                          type: x.type,
                          poster: x.poster ?? null,
                          watchUrl: x.watchUrl ?? null
                        }))}
                        onSeeAll={() => nav(`/app/provider/${row.provider}`)}
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
