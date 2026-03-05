import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="page">
        <div className="card">Loading…</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // React.ReactNode lets you pass a single element, fragments, strings, arrays, etc.
  return <>{children}</>;
}