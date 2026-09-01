import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

// Suppress the benign "ResizeObserver loop" warning that Radix popovers can
// trigger inside dialogs (it is not a real error and must not show the overlay).
const IGNORED = "ResizeObserver loop";
window.addEventListener("error", (e) => {
  if (e?.message && e.message.includes(IGNORED)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});
const _origConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === "string" && args[0].includes(IGNORED)) return;
  _origConsoleError(...args);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
