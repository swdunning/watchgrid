import { Routes, Route, Navigate } from "react-router-dom";
import Account from "./pages/Account";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Home from "./pages/Home";
import ProviderPage from "./pages/ProviderPage";
import AllLists from "./pages/AllLists"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route path="/app" element={<Home />} />
      <Route path="/app/provider/:provider" element={<ProviderPage />} />

	   <Route path="/app/account" element={<Account />} />

		<Route path="/app/all" element={<AllLists />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
