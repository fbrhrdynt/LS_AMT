import axios from "axios";

export const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  timeout: 120000,
});

let refreshPromise = null;

function canAttemptRefresh(config) {
  const url = String(config?.url || "");
  return ![
    "/auth/login",
    "/auth/logout",
    "/auth/refresh",
  ].some((path) => url.includes(path));
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (
      error.response?.status !== 401 ||
      !original ||
      original.__amtRefreshRetried ||
      !canAttemptRefresh(original)
    ) {
      return Promise.reject(error);
    }

    original.__amtRefreshRetried = true;

    try {
      if (!refreshPromise) {
        refreshPromise = axios
          .post(`${API}/auth/refresh`, {}, {
            withCredentials: true,
            timeout: 30000,
            headers: { "Cache-Control": "no-store" },
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      await refreshPromise;
      return api(original);
    } catch (refreshError) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("amt:auth-expired"));
      }
      return Promise.reject(refreshError);
    }
  }
);

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((entry) =>
        entry && typeof entry.msg === "string"
          ? entry.msg
          : JSON.stringify(entry)
      )
      .filter(Boolean)
      .join(" ");
  }
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
