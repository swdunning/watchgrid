import TitleCard, { type CardItem } from "./TitleCard";

export default function ProviderRow({
  title,
  items,
  onSeeAll,
  onRemove
}: {
  title: string;
  items: CardItem[];
  onSeeAll: () => void;
  onRemove?: (watchmodeTitleId: number) => void;
}) {
  return (
    <div>
      <div className="rowTitle">
        <h2 style={{ margin: 0 }}>{title}</h2>
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
                    style={{ padding:"8px 10px", borderRadius:10 }}
                    onClick={() => onRemove(it.watchmodeTitleId)}
                  >
                    Remove
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      ) : (
        <div className="card muted">No saved titles yet. Click “See all” to add.</div>
      )}
    </div>
  );
}
