import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import {
  LayoutDashboard,
  Wrench,
  Package,
  Building2,
  Briefcase,
  FileBarChart,
  ScrollText,
  Users,
  Search,
  LogOut,
  Menu,
  X,
  HardHat,
  Settings,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth, canManage, isAdmin } from "@/context/AuthContext";
import { RoleBadge, StatusBadge } from "@/components/StatusBadge";
import ExportButtons from "@/components/ExportButtons";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, key: "dash" },
  { to: "/equipment", label: "Equipment", icon: HardHat, key: "eq" },
  { to: "/maintenance", label: "Maintenance", icon: Wrench, key: "mnt" },
  { to: "/inventory", label: "Parts & Consumables", icon: Package, key: "inv" },
  { to: "/clients", label: "Clients", icon: Building2, key: "cli" },
  { to: "/jobs", label: "Jobs", icon: Briefcase, key: "job" },
  { to: "/reports", label: "Reports", icon: FileBarChart, key: "rep" },
  { to: "/import", label: "Excel Import", icon: ScrollText, key: "imp", manage: true },
  { to: "/audit", label: "Audit Trail", icon: ScrollText, key: "aud" },
  { to: "/users", label: "Users", icon: Users, key: "usr", admin: true },
  { to: "/settings", label: "Settings", icon: Settings, key: "set", admin: true },
];

function exportDataset(pathname) {
  if (pathname === "/") return "dashboard";
  if (pathname === "/equipment") return "equipment";
  if (pathname === "/maintenance") return "maintenance";
  if (pathname === "/inventory") return "inventory";
  if (pathname === "/clients") return "clients";
  if (pathname === "/jobs") return "jobs";
  if (pathname === "/audit") return "audit";
  if (pathname === "/users") return "users";
  return null;
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!q || q.length < 1) {
      setRes(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/search?q=${encodeURIComponent(q)}`);
        setRes(data);
        setOpen(true);
      } catch {}
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const go = (path) => {
    setOpen(false);
    setQ("");
    nav(path);
  };

  const hasResults = res && (
    res.equipment?.length || res.jobs?.length || res.clients?.length
  );

  return (
    <div className="relative w-full max-w-xl" ref={boxRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => res && setOpen(true)}
          placeholder="Search Asset/SAP, Serial/Mfg, Equipment, Job ID, Field Name, Client…"
          className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 max-h-[70vh] w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {!hasResults && <div className="px-4 py-3 text-sm text-slate-500">No results</div>}

          {res?.equipment?.length > 0 && (
            <div className="py-1">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Equipment
              </div>
              {res.equipment.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => go(`/equipment/${e.id}`)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{e.name || e.category}</div>
                    <div className="font-mono text-xs text-slate-500">
                      SAP {e.sap_no} · Mfg {e.mfg_no || "—"}
                    </div>
                  </div>
                  <StatusBadge value={e.placement} />
                </button>
              ))}
            </div>
          )}

          {res?.jobs?.length > 0 && (
            <div className="border-t border-slate-100 py-1">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Jobs
              </div>
              {res.jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => go(`/jobs/${j.id}`)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="shrink-0 font-mono text-xs text-blue-600">{j.job_number}</span>
                  <span className="min-w-0 truncate text-sm text-slate-800">
                    {j.field_name || j.job_name || "—"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {res?.clients?.length > 0 && (
            <div className="border-t border-slate-100 py-1">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Clients
              </div>
              {res.clients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go("/clients")}
                  className="flex w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = NAV.filter(
    (n) => (!n.admin || isAdmin(user)) && (!n.manage || canManage(user))
  );
  const dataset = exportDataset(loc.pathname);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:flex lg:translate-x-0",
          mobileOpen ? "flex translate-x-0" : "hidden -translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/amt-logo.webp" alt="AMT" className="h-9 w-auto object-contain" />
            <div className="leading-tight">
              <div className="font-heading text-base font-extrabold tracking-tight text-slate-900">AMT</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Asset Maintenance Tracker</div>
            </div>
          </div>
          <button className="lg:hidden" type="button" onClick={() => setMobileOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((n) => {
            const active = n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to);
            return (
              <Link
                key={n.key}
                to={n.to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
              {(user?.name || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-900">{user?.name}</div>
              <RoleBadge role={user?.role} />
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <button className="lg:hidden" type="button" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          {dataset && <ExportButtons dataset={dataset} compact />}
          <div className="ml-auto hidden items-center gap-2 text-xs text-slate-400 xl:flex">
            <span>by</span>
            <img src="/logisource-light.webp" alt="LogiSource Digital" className="h-5 w-auto object-contain opacity-70" />
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden p-4 animate-fade-in sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
