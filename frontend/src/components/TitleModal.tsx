// TitleModal.tsx
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";

type BasicItem = {
  watchmodeTitleId: number;
  title: string;
  type: string;
  poster: string | null;
  watchUrl?: string | null;
  provider?: string;
};

type TitleMeta = {
  watchmodeTitleId: number;
  title: string;
  type: string;
  poster: string | null;
  year: number | null;
  runtimeMinutes: number | null;
  seasons: number | null;
  description: string | null;
  metaStatus: "PENDING" | "OK" | "ERROR";
  lastFetchedAt: string | null;
};

type Props = {
  open: boolean;
  item: BasicItem | null;
  onClose: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
};

const normalizeTypeLabel = (t?: string | null) => {
  const s = String(t ?? "").trim();
  const lower = s.toLowerCase();

  if (lower === "tv_series" || lower === "tv") return "Series";
  if (lower === "movie") return "Movie";

  // fallback: snake_case -> Title Case
  return s
    ? s
        .replace(/_/g, " ")
        .replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    : "";
};

const formatRuntime = (mins: number) => {
  const m = Math.max(0, Math.floor(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  if (!r) return `${h}h`;
  return `${h}h ${r}m`;
};

export default function TitleModal({ open, item, onClose, onAdd, onRemove }: Props) {
  const [meta, setMeta] = useState<TitleMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
const [resolvedWatchUrl, setResolvedWatchUrl] = useState<string | null>(null);
const [loadingUrl, setLoadingUrl] = useState(false);


  // Fetch metadata when opening / switching titles (seed + ensure metadata)
  useEffect(() => {
    if (!open || !item?.watchmodeTitleId) return;

    let cancelled = false;

    setLoadingMeta(true);
    setMetaErr(null);
    setMeta(null);

    api<TitleMeta>("/api/titles/ensure", {
      method: "POST",
      body: JSON.stringify({
        watchmodeTitleId: item.watchmodeTitleId,
        title: item.title,
        type: item.type,
        poster: item.poster,
      }),
    })
      .then((data) => {
        if (cancelled) return;
        setMeta(data ?? null);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setMetaErr(e?.message ?? "Failed to load details");
        setMeta(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingMeta(false);
      });

	  setDescExpanded(false);

    return () => {
      cancelled = true;
    };
  }, [open, item?.watchmodeTitleId]);


  // Prefer DB meta fields, fallback to base item
  const poster = meta?.poster ?? item?.poster ?? null;
  const title = meta?.title ?? item?.title ?? "";
  const typeLabel = normalizeTypeLabel(meta?.type ?? item?.type ?? "");
  const provider = item?.provider ?? null;
  const watchUrl = resolvedWatchUrl ?? item?.watchUrl ?? null;


// Fetch watchUrl when opening if missing (so "Open" works for unsaved items too)
useEffect(() => {
  if (!open || !item?.watchmodeTitleId) return;

  // reset when switching titles
  setResolvedWatchUrl(null);

  // if item already has url, use it
  if (item.watchUrl) {
    setResolvedWatchUrl(item.watchUrl);
    return;
  }

  // need provider to resolve
  if (!item.provider) return;

  let cancelled = false;

  setLoadingUrl(true);

  api<{ watchUrl: string | null }>(
    `/api/watchUrl?provider=${encodeURIComponent(String(item.provider))}&watchmodeTitleId=${encodeURIComponent(
      String(item.watchmodeTitleId)
    )}`
  )
    .then((d) => {
      if (cancelled) return;
      setResolvedWatchUrl(d?.watchUrl ?? null);
    })
    .catch(() => {
      if (cancelled) return;
      setResolvedWatchUrl(null);
    })
    .finally(() => {
      if (cancelled) return;
      setLoadingUrl(false);
    });

  return () => {
    cancelled = true;
  };
}, [open, item?.watchmodeTitleId, item?.provider, item?.watchUrl]);


const chips: string[] = [];

if (meta?.year) chips.push(String(meta.year));

if (typeLabel === "Movie" && meta?.runtimeMinutes)
  chips.push(formatRuntime(meta.runtimeMinutes));

if (typeLabel === "Series" && meta?.seasons)
  chips.push(`${meta.seasons} season${meta.seasons === 1 ? "" : "s"}`);


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
        padding: 14,
      }}
      onClick={onClose}
    >
<div
  className="card"
  style={{
    width: "100%",
    maxWidth: 560,

    // ✅ stable reference size
    maxHeight: "95vh",
    overflow: "auto",

    // optional nice feel
    padding: 14,
  }}
  onClick={(e) => e.stopPropagation()}
>


        {poster ? (
          <img src={poster} alt="" style={{ width: "100%", borderRadius: 0, marginBottom: 12, maxHeight: "70vh",objectFit: "cover" }} />
        ) : null}

        <h2 style={{ marginTop: 0, marginBottom: 8 }}>{title}</h2>

        <div className="muted" style={{ marginBottom: 10 }}>
          {typeLabel}
          {provider ? ` • ${provider}` : ""}
        </div>

        {/* Quick meta row */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {loadingMeta ? (
            <span className="badge" style={{ opacity: 0.8 }}>
              Loading details…
            </span>
          ) : null}

          {chips.map((c) => (
            <span key={c} className="badge">
              {c}
            </span>
          ))}

          {/* if we tried and got nothing */}
{!loadingMeta && meta?.metaStatus === "PENDING" ? (
  <span className="badge" style={{ opacity: 0.75 }}>
    Details coming soon
  </span>
) : null}

{!loadingMeta && !meta && !metaErr ? (
  <span className="badge" style={{ opacity: 0.75 }}>
    Details not cached yet
  </span>
) : null}

{!loadingMeta && metaErr ? (
  <span className="badge" style={{ opacity: 0.75 }} title={metaErr}>
    Details unavailable
  </span>
) : null}

        </div>

{/* Description */}
{meta?.description ? (
  <>
    <p
      style={{
        marginTop: 0,
        marginBottom: 10,
        lineHeight: 1.45,
        color: "rgba(255,255,255,0.82)",
        display: "-webkit-box",
        WebkitLineClamp: descExpanded ? "unset" : 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {meta.description}
    </p>

    {meta.description.length > 160 ? (
      <button
        className="btn"
        style={{ padding: "8px 10px", borderRadius: 10, marginBottom: 14 }}
        onClick={() => setDescExpanded((v) => !v)}
      >
        {descExpanded ? "See less" : "See more"}
      </button>
    ) : (
      <div style={{ height: 4 }} />
    )}
  </>
) : loadingMeta ? (
  <div className="muted" style={{ marginBottom: 14 }}>
    Fetching description…
  </div>
) : null}


        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {loadingUrl ? (
  <button className="btn secondary" disabled>
    Resolving…
  </button>
) : watchUrl ? (
  <a className="btn secondary" href={watchUrl} target="_blank" rel="noreferrer noopener">
    Open
  </a>
) : (
  <button className="btn secondary" disabled title="No link found yet">
    Open
  </button>
)}


          {onAdd ? (
            <button className="btn" onClick={onAdd}>
              + Add
            </button>
          ) : null}

          {onRemove ? (
            <button className="btn danger" onClick={onRemove}>
              – Remove
            </button>
          ) : null}

          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
