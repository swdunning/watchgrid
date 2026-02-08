import TitleCard from "./TitleCard";
import React from "react";

type RowItem = {
  watchmodeTitleId: number;
  title: string;
  type: string;
  poster: string | null;
  watchUrl?: string | null;

  // optional metadata (used by AllLists)
  provider?: string;
  genresStatus?: "PENDING" | "OK" | "NONE" | "ERROR";
};

export default function ProviderRow({
  title,
  logoUrl,
  items,
  onSeeAll,
  onRemove,
  variant = "list",
  itemAction
}: {
  title: string;
  logoUrl?: string | null;
  items: RowItem[];
  onSeeAll?: () => void;
  onRemove?: (id: number) => void;
  variant?: "list" | "suggested";

  /**
   * Optional per-item action renderer.
   * If provided, it takes priority over onRemove.
   */
  itemAction?: (item: RowItem) => React.ReactNode;
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
        {(items || []).map((it) => {
          // Priority:
          // 1) itemAction (AllLists / special cases)
          // 2) onRemove (Provider page)
          // 3) nothing
          let action: React.ReactNode | undefined;

          if (itemAction) {
            action = itemAction(it);
          } else if (onRemove) {
            action = (
              <button
                className="btn danger"
                style={{ padding: "8px 9px", borderRadius: 10 }}
                onClick={() => onRemove(it.watchmodeTitleId)}
              >
                – Remove
              </button>
            );
          }

          return (
            <TitleCard
              key={it.watchmodeTitleId}
              item={it}
              action={action}
            />
          );
        })}
      </div>
    </div>
  );
}
