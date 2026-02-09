//TitleCard.tsx
import { useEffect, useState } from "react";
import { api } from "../api/client";

export type CardItem = {
  watchmodeTitleId: number;
  title: string;
  type: string;
  poster: string | null;
  watchUrl?: string | null;
  provider?: string;

  // optional for future / AllLists
  genres?: string[];
  genresStatus?: "PENDING" | "OK" | "NONE" | "ERROR";
};

export default function TitleCard({
  item,
  action,
  onWatchUrlResolved,
  onPosterClick,
}: {
  item: CardItem;
  action?: React.ReactNode;
  onWatchUrlResolved?: (url: string | null) => void;
  onPosterClick?: (item: CardItem) => void;
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

  const openStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 12,
    lineHeight: "14px",
  };

  const handleOpen = async () => {
    if (resolvedUrl) return;
    if (!item.provider) return;
    if (opening) return;

    setOpening(true);

    const win = window.open("about:blank", "_blank");
    if (!win) {
      setOpening(false);
      alert("Popup blocked. Please allow popups for WatchGrid to use Open.");
      return;
    }

    try {
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

      // ✅ Tell parent so it can patch list/search rows
      onWatchUrlResolved?.(url);

      if (!url) {
        win.close();
        return;
      }

      setResolvedUrl(url);
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

  const posterClickable = !!onPosterClick;

  return (
    <div className="posterCard">
      {item.poster ? (
        posterClickable ? (
          <button
            type="button"
            onClick={() => onPosterClick?.(item)}
            aria-label={`Open details for ${item.title}`}
            style={{
              all: "unset",
              display: "block",
              width: "100%",
              cursor: "pointer",
            }}
          >
            <img className="posterImg" src={item.poster} alt={item.title} />
          </button>
        ) : (
          <img className="posterImg" src={item.poster} alt={item.title} />
        )
      ) : posterClickable ? (
        <button
          type="button"
          onClick={() => onPosterClick?.(item)}
          aria-label={`Open details for ${item.title}`}
          style={{ all: "unset", display: "block", width: "100%", cursor: "pointer" }}
        >
          <div className="posterImg" />
        </button>
      ) : (
        <div className="posterImg" />
      )}

      <div className="posterBody">
        <p className="posterTitle" title={item.title}>
          {item.title}
        </p>

        <div className="badge">
          {item.type}
          {item.provider ? ` • ${item.provider}` : ""}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {resolvedUrl ? (
            <a className="btn secondary" style={openStyle} href={resolvedUrl} target="_blank" rel="noreferrer noopener">
              Open
            </a>
          ) : (
            <button
              className="btn secondary"
              style={openStyle}
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
