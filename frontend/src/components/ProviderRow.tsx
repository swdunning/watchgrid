import TitleCard from "./TitleCard";

type RowItem = {
  watchmodeTitleId: number;
  title: string;
  type: string;
  poster: string | null;
  watchUrl?: string | null;
};

export default function ProviderRow({
  title,
  logoUrl,
  items,
  onSeeAll,
  onRemove,
  variant = "list"
}: {
  title: string;
  logoUrl?: string | null;
  items: RowItem[];
  onSeeAll?: () => void;
  onRemove?: (id: number) => void;
  variant?: "list" | "suggested";
}) {
  return (
    <div className={`wgRow ${variant === "suggested" ? "wgRowSuggested" : ""}`}>
      <div className="wgRowHeader">
        <div className="wgRowTitleWrap">
          {logoUrl ? <img className="wgRowLogo" src={logoUrl} alt="" /> : null}
          <div className="wgRowTitle">{title}</div>
        </div>

        {onSeeAll ? (
          <button className="wgPillBtn" onClick={onSeeAll}>
  See all
</button>

        ) : null}
      </div>

      <div className="rail">
        {(items || []).map((it) => (
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
    </div>
  );
}
