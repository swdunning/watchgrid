import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page"><div className="card">Loading…</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
