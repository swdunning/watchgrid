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
  const [rateLimited, setRateLimited] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadingHome, setLoadingHome] = useState(true);

  const loadHome = async () => {
    setLoadingHome(true);
    setErr(null);
    try {
      const data = await api<{ rows: HomeRow[]; rateLimited?: boolean }>("/api/home");
      setRows(data.rows || []);
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
          <p className="muted">
            Your lists plus popular picks for each service you selected.
          </p>

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
            rows.map((row) => (
              <div key={row.provider} style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                <ProviderRow
                  title={`My List • ${row.label}`}
                  items={(row.savedItems || []).map((x: any) => ({
                    watchmodeTitleId: x.watchmodeTitleId,
                    title: x.title,
                    type: x.type,
                    poster: x.poster ?? null,
                    watchUrl: x.watchUrl ?? null
                  }))}
                  onSeeAll={() => nav(`/app/provider/${row.provider}`)}
                />

                <ProviderRow
                  title={`Popular on ${row.label}`}
                  items={(row.popularItems || []).map((x: any) => ({
                    watchmodeTitleId: x.watchmodeTitleId,
                    title: x.title,
                    type: x.type,
                    poster: x.poster ?? null,
                    watchUrl: x.watchUrl ?? null
                  }))}
                  onSeeAll={() => nav(`/app/provider/${row.provider}`)}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
