import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  item: {
    watchmodeTitleId: number;
    title: string;
    type: string;
    poster: string | null;
    watchUrl?: string | null;
    provider?: string;
  } | null;
  onClose: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
};

const normalizeType = (t: string) => {
  const lower = t.toLowerCase();
  if (lower.includes("tv")) return "Series";
  if (lower.includes("movie")) return "Movie";
  return t;
};

export default function TitleModal({ open, item, onClose, onAdd, onRemove }: Props) {
  if (!open || !item) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 420, width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        {item.poster && (
          <img
            src={item.poster}
            alt=""
            style={{ width: "100%", borderRadius: 12, marginBottom: 12 }}
          />
        )}

        <h2 style={{ marginTop: 0 }}>{item.title}</h2>

        <div className="muted" style={{ marginBottom: 14 }}>
          {normalizeType(item.type)}
          {item.provider ? ` • ${item.provider}` : ""}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {item.watchUrl && (
            <a className="btn" href={item.watchUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          )}

          {onAdd && (
            <button className="btn" onClick={onAdd}>
              + Add
            </button>
          )}

          {onRemove && (
            <button className="btn secondary" onClick={onRemove}>
              Remove
            </button>
          )}

          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
