import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  HardHat,
  CheckCircle2,
  Wrench,
  Warehouse,
  Building,
  Briefcase,
  Truck,
  AlertTriangle,
  PackageX,
  CalendarClock,
  FileWarning,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { Panel, EmptyState } from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";

function Stat({ icon: Icon, label, value, tone = "slate", onClick, testId }) {
  const tones = {
    slate: "text-slate-500",
    green: "text-green-600",
    amber: "text-amber-600",
    blue: "text-blue-600",
    violet: "text-violet-600",
    orange: "text-orange-600",
    red: "text-red-600",
  };

  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300 hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${tones[tone]}`} />
      </div>
      <span className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
        {value ?? 0}
      </span>
    </button>
  );
}

export default function Dashboard() {
  const [d, setD] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    api.get("/dashboard").then((r) => setD(r.data)).catch(() => {});
  }, []);

  if (!d) return <div className="text-slate-400">Loading dashboard…</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Maintenance operations at a glance
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat
          icon={HardHat}
          label="Total Equipment"
          value={d.total_equipment}
          testId="stat-total"
          onClick={() => nav("/equipment")}
        />
        <Stat
          icon={CheckCircle2}
          label="Green Tag / Ready"
          value={d.operational}
          tone="green"
          onClick={() => nav("/equipment?status=Operational")}
        />
        <Stat
          icon={Wrench}
          label="Red Tag / Under Maintenance"
          value={d.under_maintenance}
          tone="red"
          onClick={() => nav("/equipment?status=Under%20Maintenance")}
        />
        <Stat
          icon={Building}
          label="At Base"
          value={d.at_base}
          onClick={() => nav("/equipment?placement=Base")}
        />
        <Stat
          icon={Warehouse}
          label="At Workshop"
          value={d.at_workshop}
          tone="violet"
          onClick={() => nav("/equipment?placement=Workshop")}
        />
        <Stat
          icon={Briefcase}
          label="On Job"
          value={d.on_job}
          tone="blue"
          onClick={() => nav("/equipment?placement=Job")}
        />
        <Stat
          icon={Truck}
          label="In Transit"
          value={d.in_transit}
          tone="orange"
          onClick={() => nav("/equipment?placement=Transit")}
        />
        <Stat
          icon={Briefcase}
          label="Active Jobs"
          value={d.active_jobs}
          tone="blue"
          onClick={() => nav("/jobs")}
        />
        <Stat
          icon={CalendarClock}
          label="Maint. This Month"
          value={d.maintenance_this_month}
          onClick={() => nav("/maintenance")}
        />
        <Stat
          icon={Wrench}
          label="Open Maintenance"
          value={d.open_maintenance}
          tone="amber"
          onClick={() => nav("/maintenance?status=Open")}
        />
        <Stat
          icon={FileWarning}
          label="Repeated Failures"
          value={d.repeated_failures}
          tone="red"
        />
        <Stat
          icon={PackageX}
          label="Low Stock"
          value={d.low_stock}
          tone="red"
          onClick={() => nav("/inventory?low=1")}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title="Recent Maintenance" className="lg:col-span-2">
          <div className="divide-y divide-slate-100">
            {d.recent_maintenance?.length ? (
              d.recent_maintenance.map((m) => (
                <button
                  key={m.id}
                  onClick={() => nav(`/equipment/${m.equipment_id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  data-testid={`recent-mnt-${m.id}`}
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-blue-600 sm:w-28">
                    {m.mnt_no}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {m.equipment_name || m.sap_no}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {m.maintenance_purpose || m.problem_damage || m.type_of_maintenance}
                    </div>
                  </div>
                  <span className="hidden shrink-0 font-mono text-xs text-slate-400 sm:block">
                    {fmtDate(m.maintenance_date)}
                  </span>
                  <span className="shrink-0">
                    <StatusBadge value={m.status} />
                  </span>
                </button>
              ))
            ) : (
              <EmptyState icon={Wrench} text="No maintenance yet" />
            )}
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel title="Most Common Failures">
            <div className="divide-y divide-slate-100">
              {d.most_common_failures?.length ? (
                d.most_common_failures.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700" title={f.failure_name}>
                      {f.failure_name}
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold text-red-600">
                      {f.count}×
                    </span>
                  </div>
                ))
              ) : (
                <EmptyState icon={AlertTriangle} text="No failures logged" />
              )}
            </div>
          </Panel>

          <Panel title="Most Consumed Parts">
            <div className="divide-y divide-slate-100">
              {d.most_consumed_parts?.length ? (
                d.most_consumed_parts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      {p.item_name}
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold text-slate-900">
                      {p.qty}
                    </span>
                  </div>
                ))
              ) : (
                <EmptyState icon={PackageX} text="No parts consumed" />
              )}
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Equipment With Most Failures">
          <div className="divide-y divide-slate-100">
            {d.equipment_most_failures?.length ? (
              d.equipment_most_failures.map((e) => (
                <button
                  key={e.equipment.id}
                  onClick={() => nav(`/equipment/${e.equipment.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {e.equipment.name || e.equipment.category}
                    </div>
                    <div className="font-mono text-xs text-slate-500">
                      SAP {e.equipment.sap_no}
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-sm font-bold text-red-600">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {e.count}
                  </span>
                </button>
              ))
            ) : (
              <EmptyState icon={AlertTriangle} text="No failures logged" />
            )}
          </div>
        </Panel>

        <Panel title="Low Stock Items">
          <div className="divide-y divide-slate-100">
            {d.low_stock_items?.length ? (
              d.low_stock_items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {it.item_name}
                    </div>
                    <div className="truncate font-mono text-xs text-slate-500">
                      {it.item_code} · {it.storage_location}
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap font-mono text-sm">
                    <b className="text-red-600">{it.stock}</b>{" "}
                    <span className="text-slate-400">
                      / {it.min_stock} {it.unit}
                    </span>
                  </span>
                </div>
              ))
            ) : (
              <EmptyState icon={CheckCircle2} text="All stock levels healthy" />
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
