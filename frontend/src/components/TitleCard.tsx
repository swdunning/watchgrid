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
  action
}: {
  item: CardItem;
  action?: React.ReactNode;
}) {
  return (
    <div className="posterCard">
      {item.poster ? (
        <img className="posterImg" src={item.poster} alt={item.title} />
      ) : (
        <div className="posterImg" />
      )}
      <div className="posterBody">
        <p className="posterTitle" title={item.title}>{item.title}</p>
        <div className="badge">{item.type}{item.provider ? ` • ${item.provider}` : ""}</div>
        <div style={{ display:"flex", gap:8, marginTop:10 }}>
          {item.watchUrl ? (
            <a className="btn secondary" style={{ padding:"8px 10px", borderRadius:10 }} href={item.watchUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          ) : (
            <button className="btn secondary" style={{ padding:"8px 10px", borderRadius:10 }} disabled>
              Open
            </button>
          )}
          {action}
        </div>
      </div>
    </div>
  );
}
