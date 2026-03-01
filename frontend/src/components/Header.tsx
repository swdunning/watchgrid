import { useNavigate } from "react-router-dom";
import wgLogo from "../assets/watchgrid-logo.png"

export default function Header({ right }: { right?: React.ReactNode }) {
  const nav = useNavigate();

  return (
    <div className="header">
      <div className="headerInner">
        <div className="brand" style={{ cursor: "pointer" }} onClick={() => nav("/")}>
          <img
			src={wgLogo}
			alt="WatchGrid"
			className="wgHeaderLogo"
			/>
        </div>
        <div>{right}</div>
      </div>
    </div>
  );
}
