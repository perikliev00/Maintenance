import { useEffect, useState } from "react";
import { LoginPage } from "./pages/LoginPage";
import { RoomsPage } from "./pages/RoomsPage";
import { clearToken, getToken, getStoredUser, type AuthUser } from "./api/client";
import "./App.css";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getToken());

  useEffect(() => {
    if (!token) {
      setUser(null);
    }
  }, [token]);

  if (!token || !user) {
    return (
      <LoginPage
        onLogin={(nextToken, nextUser) => {
          setToken(nextToken);
          setUser(nextUser);
        }}
      />
    );
  }

  return (
    <RoomsPage
      user={user}
      onLogout={() => {
        clearToken();
        setToken(null);
        setUser(null);
      }}
    />
  );
}
