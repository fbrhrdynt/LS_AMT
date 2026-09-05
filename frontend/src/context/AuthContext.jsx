import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { api, formatApiError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const expired = () => setUser(false);
    window.addEventListener("amt:auth-expired", expired);
    return () => window.removeEventListener("amt:auth-expired", expired);
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
    return data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    setUser(false);
  };

  return (
    <AuthContext.Provider
      value={{ user, setUser, login, logout, checkAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
export const canManage = (user) =>
  user && ["admin", "supervisor"].includes(user.role);
export const canEdit = (user) =>
  user && ["admin", "supervisor", "technician"].includes(user.role);
export const isAdmin = (user) => user && user.role === "admin";
export { formatApiError };
