import { useNavigate } from "react-router-dom";
import Header from "../components/Header";

export default function Landing() {
  const nav = useNavigate();

  return (
    <>
      <Header
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => nav("/login")}>Log in</button>
            <button className="btn" onClick={() => nav("/register")}>Create account</button>
          </div>
        }
      />

      <div className="page">
        <div className="card">
          <h1 style={{ marginTop: 0, fontSize: 40, lineHeight: 1.1 }}>
            Your streaming universe — organized.
          </h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 760 }}>
            Pick the services you have, then build saved lists per service — displayed in Netflix-style rows.
            Search across your subscriptions or jump into one provider.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button className="btn" onClick={() => nav("/register")}>Create account</button>
            <button className="btn secondary" onClick={() => nav("/login")}>Log in</button>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="rowTitle">
            <h2 style={{ margin: 0 }}>Preview</h2>
            <div className="muted">Example rows</div>
          </div>
          <div className="card">
            <div className="rail">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="posterCard">
                  <div className="posterImg" />
                  <div className="posterBody">
                    <p className="posterTitle">Your list</p>
                    <div className="badge">Provider row</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
