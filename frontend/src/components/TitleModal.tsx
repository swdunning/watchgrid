//TitleModal.tsx
import { createPortal } from "react-dom";
import type { CardItem } from "./TitleCard";

type Props = {
  open: boolean;
  item: CardItem | null;
  onClose: () => void;
  action?: React.ReactNode; // optional custom actions (Add/Remove/etc)
};

const normalizeType = (t: string) => {
  const lower = t.toLowerCase();
  if (lower.includes("tv")) return "Series";
  if (lower.includes("movie")) return "Movie";
  return t;
};

export default function TitleModal({ open, item, onClose, action }: Props) {
  if (!open || !item) return null;

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

  const genres =
    item.genres && item.genres.length ? item.genres.join(", ") : null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 460, width: "100%", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {item.poster ? (
          <img
            src={item.poster}
            alt=""
            style={{ width: "100%", borderRadius: 12, marginBottom: 12 }}
          />
        ) : null}

        <h2 style={{ marginTop: 0, marginBottom: 6 }}>{item.title}</h2>

        <div className="muted" style={{ marginBottom: 10 }}>
          {normalizeType(item.type)}
          {item.provider ? ` • ${item.provider}` : ""}
        </div>

        {/* Info we already have (no extra calls) */}
        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          <div className="badge" style={{ display: "inline-flex", width: "fit-content" }}>
            Watchmode ID: {item.watchmodeTitleId}
          </div>

          {genres ? (
            <div className="muted" style={{ fontWeight: 800 }}>
              Genres: <span style={{ fontWeight: 600 }}>{genres}</span>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {item.watchUrl ? (
            <a
              className="btn secondary"
              style={openStyle}
              href={item.watchUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open
            </a>
          ) : null}

          {action}

          <button className="btn secondary" style={openStyle} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
