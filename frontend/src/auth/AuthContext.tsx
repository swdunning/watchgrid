import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/client";

export type ProviderKey =
  | "NETFLIX" | "HULU" | "PRIME" | "MAX" | "DISNEY" | "APPLETV" | "PARAMOUNT" | "PEACOCK";

export const PROVIDERS: { key: ProviderKey; label: string }[] = [
  { key: "NETFLIX", label: "Netflix" },
  { key: "HULU", label: "Hulu" },
  { key: "MAX", label: "Max" },
  { key: "PRIME", label: "Prime Video" },
  { key: "DISNEY", label: "Disney+" },
  { key: "APPLETV", label: "Apple TV+" },
  { key: "PARAMOUNT", label: "Paramount+" },
  { key: "PEACOCK", label: "Peacock" }
];

type User = { id: string; email: string; providers: ProviderKey[] };

type AuthState = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api<{ user: User | null }>("/api/auth/me");
      setUser(data.user);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Ctx.Provider value={{ user, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
