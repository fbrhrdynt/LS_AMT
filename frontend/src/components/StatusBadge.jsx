import { cn } from "@/lib/utils";

const STATUS_MAP = {
  Operational: "bg-green-100 text-green-800 border-green-200",
  "Under Maintenance": "bg-amber-100 text-amber-800 border-amber-200",
  "Out of Service": "bg-red-100 text-red-800 border-red-200",
  Standby: "bg-slate-100 text-slate-700 border-slate-200",
  Open: "bg-amber-100 text-amber-800 border-amber-200",
  Closed: "bg-green-100 text-green-800 border-green-200",
  Active: "bg-blue-100 text-blue-800 border-blue-200",
  Base: "bg-slate-100 text-slate-700 border-slate-200",
  Workshop: "bg-violet-100 text-violet-800 border-violet-200",
  Job: "bg-blue-100 text-blue-800 border-blue-200",
  Transit: "bg-orange-100 text-orange-800 border-orange-200",
};

export function StatusBadge({ value, className, testId }) {
  const cls = STATUS_MAP[value] || "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span
      data-testid={testId}
      className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", cls, className)}
    >
      {value || "—"}
    </span>
  );
}

const ROLE_MAP = {
  admin: "bg-slate-900 text-white border-slate-900",
  supervisor: "bg-blue-100 text-blue-800 border-blue-200",
  technician: "bg-teal-100 text-teal-800 border-teal-200",
  viewer: "bg-slate-100 text-slate-600 border-slate-200",
};

export function RoleBadge({ role }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", ROLE_MAP[role] || ROLE_MAP.viewer)}>
      {role}
    </span>
  );
}
