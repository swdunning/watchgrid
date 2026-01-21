import TitleCard, { type TitleItem } from "./TitleCard";

export default function ProviderRow({
  title,
  logoUrl,
  items,
  onSeeAll,
  onRemove
}: {
  title: string;
  logoUrl?: string | null;
  items: TitleItem[];
  onSeeAll: () => void;
  onRemove?: (watchmodeTitleId: number) => void;
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                objectFit: "contain",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
                padding: 4
              }}
            />
          ) : (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)"
              }}
            />
          )}

          <h2 style={{ margin: 0 }}>{title}</h2>
        </div>

        <button className="btn secondary" onClick={onSeeAll}>See all</button>
      </div>

      {items.length ? (
        <div className="rail">
          {items.map((it) => (
            <TitleCard
              key={it.watchmodeTitleId}
              item={it}
              action={
                onRemove ? (
                  <button
                    className="btn secondary"
                    style={{ padding: "8px 10px", borderRadius: 10 }}
                    onClick={() => onRemove(it.watchmodeTitleId)}
                  >
                    Remove
                  </button>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <div className="card muted">Nothing here yet.</div>
      )}
    </div>
  );
}
