// TitleCard.tsx
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

const formatTypeLabel = (type: string) => {
  const t = type.toLowerCase();
  if (t.includes("tv")) return "Series";
  if (t.includes("movie")) return "Movie";

  // fallback: Title Case
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export default function TitleCard({
  item,
  action,
  onWatchUrlResolved,
  onPosterClick,
  onCardClick, // ✅ new: whole-card click
}: {
  item: CardItem;
  action?: React.ReactNode;
  onWatchUrlResolved?: (url: string | null) => void;
  onPosterClick?: (item: CardItem) => void;
  onCardClick?: (item: CardItem) => void; // ✅ new
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(item.watchUrl ?? null);
  const [opening, setOpening] = useState(false);

  // keep local resolvedUrl in sync if parent patches item.watchUrl later
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

      // tell parent so it can patch state
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

  /**
   * Teaching note:
   * - We make the whole card clickable by putting onClick on the wrapper.
   * - BUT buttons/links inside the card would also trigger that click because events "bubble".
   * - So we stop bubbling for the actions area and the Open link/button.
   */
  const cardClickable = !!onCardClick || !!onPosterClick;
  const handleCardClick = () => {
    if (onCardClick) return onCardClick(item);
    if (onPosterClick) return onPosterClick(item);
  };

  return (
    <div
      className="posterCard"
      role={cardClickable ? "button" : undefined}
      tabIndex={cardClickable ? 0 : undefined}
      onClick={cardClickable ? handleCardClick : undefined}
      onKeyDown={
        cardClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCardClick();
              }
            }
          : undefined
      }
      style={cardClickable ? { cursor: "pointer" } : undefined}
    >
      {item.poster ? (
        <img className="posterImg" src={item.poster ?? undefined} alt={item.title} loading="lazy" decoding="async" />
      ) : (
        <div className="posterImg" />
      )}

      <div className="posterBody">
        <p className="posterTitle" title={item.title}>
          {item.title}
        </p>

        <div className="badge">
          {formatTypeLabel(item.type)}
          {item.provider ? ` • ${item.provider}` : ""}
        </div>

        {/* ✅ Stop clicks in the action area from opening the modal */}
        <div
          style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {resolvedUrl ? (
            <a
              className="btn secondary"
              style={openStyle}
              href={resolvedUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
            >
              Open
            </a>
          ) : (
            <button
              className="btn secondary"
              style={openStyle}
              onClick={(e) => {
                e.stopPropagation();
                handleOpen();
              }}
              disabled={opening || !item.provider}
              title={!item.provider ? "No provider available to resolve link" : "Open on provider"}
            >
              {opening ? "Opening…" : "Open"}
            </button>
          )}

          {/* action is usually +Add / Remove, etc. */}
          {action}
        </div>
      </div>
    </div>
  );
}