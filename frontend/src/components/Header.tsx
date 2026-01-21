import { useNavigate } from "react-router-dom";

export default function Header({ right }: { right?: React.ReactNode }) {
  const nav = useNavigate();

  return (
    <div className="header">
      <div className="headerInner">
        <div className="brand" style={{ cursor: "pointer" }} onClick={() => nav("/")}>
          <div className="mark" />
          <div>WatchGrid</div>
        </div>
        <div>{right}</div>
      </div>
    </div>
  );
}
