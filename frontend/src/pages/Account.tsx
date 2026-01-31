import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { api } from "../api/client";

type ProviderMeta = { provider: string; label: string; logoUrl?: string | null };

export default function Account() {
  const nav = useNavigate();

  const [email, setEmail] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [allProviders, setAllProviders] = useState<ProviderMeta[]>([]);

  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const acct = await api<{ user: { email: string; providers: string[] } }>("/api/account");
      setEmail(acct.user.email);
      setNewEmail(acct.user.email);
      setProviders((acct.user.providers || []).map((p) => String(p).toUpperCase()));

      // meta list for provider chooser (if your backend exposes it)
      try {
        const meta = await api<{ providers: ProviderMeta[] }>("/api/meta/providers");
        setAllProviders(meta.providers || []);
      } catch {
        // fallback: minimal list from current providers
        setAllProviders((acct.user.providers || []).map((p) => ({ provider: p, label: p })));
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load account");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleProvider = (p: string) => {
    const key = p.toUpperCase();
    setProviders((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const saveEmailPassword = async () => {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const body: any = {};
      if (newEmail.trim() && newEmail.trim().toLowerCase() !== email.toLowerCase()) body.email = newEmail.trim();
      if (newPassword.trim()) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
      }

      await api("/api/account", {
        method: "PUT",
        body: JSON.stringify(body)
      });

      setMsg("Account updated.");
      setCurrentPassword("");
      setNewPassword("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update account");
    } finally {
      setSaving(false);
    }
  };

  const saveProviders = async () => {
    if (providers.length === 0) {
      setErr("Select at least one provider.");
      return;
    }
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      await api("/api/account/providers", {
        method: "PUT",
        body: JSON.stringify({ providers })
      });
      setMsg("Providers updated.");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update providers");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => nav("/app")}>
              ← Home
            </button>
          </div>
        }
      />

      <div className="page" style={{ display: "grid", gap: 14 }}>
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Account</h1>
          <p className="muted">Update your email/password and manage streaming services.</p>
          {err && <div style={{ color: "#ff5b7a", marginTop: 10 }}>{err}</div>}
          {msg && <div style={{ color: "#8ff0a4", marginTop: 10 }}>{msg}</div>}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Email & Password</h2>

          <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Email</div>
              <input className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>Current password (required if changing password)</div>
              <input
                className="input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 6 }}>New password</div>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
              />
            </div>

            <button className="btn" onClick={saveEmailPassword} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Streaming Services</h2>
          <p className="muted">These control what you see on Home and what services your search/browse uses.</p>

          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {(allProviders.length ? allProviders : providers.map((p) => ({ provider: p, label: p }))).map((p) => {
                const key = String(p.provider).toUpperCase();
                const active = providers.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`btn ${active ? "" : "secondary"}`}
                    onClick={() => toggleProvider(key)}
                    style={{ borderRadius: 999, padding: "8px 12px" }}
                  >
                    {p.label || key}
                  </button>
                );
              })}
            </div>

            <button className="btn" onClick={saveProviders} disabled={saving}>
              {saving ? "Saving…" : "Save providers"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
