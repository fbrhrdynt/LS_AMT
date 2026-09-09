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
export const ALL_MENU_KEYS = [
  "dash",
  "eq",
  "mnt",
  "cal",
  "inv",
  "cli",
  "job",
  "rep",
  "imp",
  "aud",
  "usr",
  "set",
];

export const isMasterAdmin = (user) =>
  Boolean(user && user.role === "master_admin");

export const canManage = (user) =>
  user &&
  ["master_admin", "admin", "supervisor"].includes(user.role);

export const canEdit = (user) =>
  user &&
  ["master_admin", "admin", "supervisor", "technician"].includes(user.role);

export const isAdmin = (user) =>
  Boolean(
    user &&
      ["master_admin", "admin"].includes(user.role)
  );

export const canManageUsers = (user) =>
  Boolean(
    user &&
      [
        "master_admin",
        "admin",
        "supervisor",
      ].includes(user.role)
  );

export const hasMenuAccess = (user, key) => {
  if (!user) return false;
  if (isMasterAdmin(user)) return true;
  if (!Array.isArray(user.menu_access)) return true;
  return user.menu_access.includes(key);
};

export { formatApiError };
