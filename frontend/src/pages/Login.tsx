import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { api } from "../api/client";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setErr(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      nav("/app");
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <div className="page">
        <div className="card formCard">
          <h1 style={{ marginTop: 0 }}>Log in</h1>
          <div style={{ display:"grid", gap:10, marginTop:14 }}>
            <input className="input" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} />
            <input className="input" placeholder="Password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} />
            {err && <div style={{ color:"#ff5b7a" }}>{err}</div>}
            <button className="btn" onClick={submit} disabled={loading}>
              {loading ? "Logging in..." : "Log in"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
