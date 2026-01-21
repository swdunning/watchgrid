import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { api } from "../api/client";

const PROVIDERS = [
  { key: "NETFLIX", label: "Netflix" },
  { key: "HULU", label: "Hulu" },
  { key: "MAX", label: "Max" },
  { key: "PRIME", label: "Prime Video" },
  { key: "DISNEY", label: "Disney+" },
  { key: "APPLETV", label: "Apple TV+" },
  { key: "PARAMOUNT", label: "Paramount+" },
  { key: "PEACOCK", label: "Peacock" }
] as const;

type ProviderKey = typeof PROVIDERS[number]["key"];

export default function Register() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<ProviderKey[]>(["NETFLIX"]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = (k: ProviderKey) => {
    setSelected((prev) => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  };

  const submit = async () => {
    setLoading(true);
    setErr(null);
    try {
      await api<{ user: any }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, providers: selected })
      });
      nav("/app");
    } catch (e: any) {
      setErr(e?.message ?? "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <div className="page">
        <div className="card" style={{ maxWidth: 760 }}>
          <h1 style={{ marginTop: 0 }}>Create your WatchGrid</h1>
          <p className="muted">Select your streaming services — your Home rows will match.</p>

          <div style={{ display:"grid", gap:10, gridTemplateColumns:"1fr 1fr", marginTop:14 }}>
            <input className="input" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} />
            <input className="input" placeholder="Password (8+ chars)" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} />
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="muted" style={{ marginBottom: 8 }}>Your services</div>
            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              {PROVIDERS.map(p => {
                const on = selected.includes(p.key);
                return (
                  <button key={p.key} className={`btn ${on ? "" : "secondary"}`} onClick={() => toggle(p.key)} type="button">
                    {on ? "✓ " : ""}{p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {err && <div style={{ color:"#ff5b7a", marginTop: 10 }}>{err}</div>}

          <div style={{ display:"flex", gap:10, marginTop:14 }}>
            <button className="btn" onClick={submit} disabled={loading}>
              {loading ? "Creating..." : "Create account"}
            </button>
            <button className="btn secondary" onClick={() => nav("/login")}>Already have an account?</button>
          </div>
        </div>
      </div>
    </>
  );
}
