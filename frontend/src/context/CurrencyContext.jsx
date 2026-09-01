import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  const [currency, setCurrencyState] = useState("USD");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/settings");
      if (data?.currency) setCurrencyState(data.currency);
    } catch { /* not authed yet -> default */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setCurrency = async (code) => {
    await api.put("/settings", { currency: code });
    setCurrencyState(code);
  };

  const format = useCallback((amount) => {
    const n = Number(amount || 0);
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `${currency} ${n.toLocaleString()}`;
    }
  }, [currency]);

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, format, reload: load }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext) || { currency: "USD", format: (a) => String(a ?? "") };
