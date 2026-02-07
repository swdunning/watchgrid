// frontend/src/components/TitleCard.tsx
import { useEffect, useState } from "react";
import { api } from "../api/client";

export type CardItem = {
  watchmodeTitleId: number;
  title: string;
  type: string;
  poster: string | null;
  watchUrl?: string | null;
  provider?: string;
};

export default function TitleCard({
  item,
  action,
  onWatchUrlResolved,
}: {
  item: CardItem;
  action?: React.ReactNode;
  onWatchUrlResolved?: (url: string | null) => void;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(item.watchUrl ?? null);
  const [opening, setOpening] = useState(false);

  // ✅ If parent later patches item.watchUrl (e.g. via onWatchUrlResolved),
  // keep local state in sync so the button becomes a real <a>.
  useEffect(() => {
    if (item.watchUrl && item.watchUrl !== resolvedUrl) {
      setResolvedUrl(item.watchUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.watchUrl]);

  const handleOpen = async () => {
    // If we already have the URL, let the <a> handle it (this handler won't be used).
    if (resolvedUrl) return;

    // Need provider to resolve a Watchmode deep link.
    if (!item.provider) return;

    if (opening) return;
    setOpening(true);

    // ✅ Open synchronously so browsers treat it as a user gesture.
    const win = window.open("about:blank", "_blank");

    // If popup was blocked, stop here (don't navigate current tab).
    if (!win) {
      setOpening(false);
      alert("Popup blocked. Please allow popups for WatchGrid to use Open.");
      return;
    }

    try {
      // While it's still about:blank (same-origin), we can safely detach opener.
      // This gives us the security benefit of noopener without losing the handle.
      try {
        (win as any).opener = null;
      } catch {
        // ignore
      }

      const res = await api<{ watchUrl: string | null }>(
        `/api/watchurl?provider=${encodeURIComponent(item.provider)}&watchmodeTitleId=${encodeURIComponent(
          String(item.watchmodeTitleId)
        )}`
      );

      const url = res?.watchUrl ?? null;

      // ✅ Tell parent so it can patch list/search rows (survives re-render + reload after DB persist)
      onWatchUrlResolved?.(url);

      if (!url) {
        win.close();
        return;
      }

      // Cache in local UI so next click uses a normal <a>.
      setResolvedUrl(url);

      // Navigate the already-opened tab.
      win.location.href = url;
    } catch {
      try {
        win.close();
      } catch {
        // ignore
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="posterCard">
      {item.poster ? <img className="posterImg" src={item.poster} alt={item.title} /> : <div className="posterImg" />}

      <div className="posterBody">
        <p className="posterTitle" title={item.title}>
          {item.title}
        </p>

        <div className="badge">
          {item.type}
          {item.provider ? ` • ${item.provider}` : ""}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {/* Best-case: real link = no blockers */}
          {resolvedUrl ? (
            <a
              className="btn secondary"
              style={{ padding: "8px 10px", borderRadius: 10 }}
              href={resolvedUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open
            </a>
          ) : (
            <button
              className="btn secondary"
              style={{ padding: "8px 10px", borderRadius: 10 }}
              onClick={handleOpen}
              disabled={opening || !item.provider}
              title={!item.provider ? "No provider available to resolve link" : "Open on provider"}
            >
              {opening ? "Opening…" : "Open"}
            </button>
          )}

          {action}
        </div>
      </div>
    </div>
  );
}
