import {
  useEffect,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  HardHat,
  CheckCircle2,
  Wrench,
  Warehouse,
  Building,
  Briefcase,
  Truck,
  PackageX,
  CalendarClock,
  FileWarning,
  TrendingUp,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  PageHeader,
  Panel,
} from "@/components/Bits";
import DataTable from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";


function Stat({
  icon: Icon,
  label,
  value,
  tone = "slate",
  onClick,
  testId,
}) {
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
        <Icon
          className={`h-4 w-4 ${tones[tone]}`}
        />
      </div>

      <span className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
        {value ?? 0}
      </span>
    </button>
  );
}


function DashboardTable({
  data,
  columns,
  minWidth,
  emptyText,
  onRowClick,
  testIdPrefix,
  maxHeight,
}) {
  return (
    <DataTable
      data={data || []}
      columns={columns}
      pageSize={1000}
      minWidth={minWidth}
      emptyText={emptyText}
      onRowClick={onRowClick}
      testIdPrefix={testIdPrefix}
      compact
      embedded
      maxHeight={maxHeight}
    />
  );
}


export default function Dashboard() {
  const [d, setD] =
    useState(null);
  const nav = useNavigate();

  useEffect(() => {
    api
      .get("/dashboard")
      .then((response) =>
        setD(response.data)
      )
      .catch(() => {});
  }, []);

  if (!d) {
    return (
      <div className="text-slate-400">
        Loading dashboard…
      </div>
    );
  }

  const recentColumns = [
    {
      key: "mnt_no",
      header: "Maintenance ID",
      className:
        "whitespace-nowrap font-mono text-xs font-semibold text-blue-600",
    },
    {
      key: "equipment",
      header: "Equipment",
      render: (mnt) => (
        <div className="min-w-[260px]">
          <div className="font-medium text-slate-900">
            {mnt.equipment_name ||
              mnt.sap_no}
          </div>
          <div className="max-w-[440px] text-xs text-slate-500">
            {mnt.maintenance_purpose ||
              mnt.problem_damage ||
              mnt.type_of_maintenance ||
              "—"}
          </div>
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      className:
        "whitespace-nowrap font-mono text-xs text-slate-500",
      render: (mnt) =>
        fmtDate(
          mnt.maintenance_date
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (mnt) => (
        <StatusBadge
          value={mnt.status}
        />
      ),
    },
  ];

  const failureColumns = [
    {
      key: "failure_name",
      header: "Failure",
      className:
        "min-w-[360px] text-slate-700",
    },
    {
      key: "count",
      header: "Count",
      align: "right",
      render: (failure) => (
        <span className="whitespace-nowrap font-mono font-bold text-red-600">
          {failure.count}×
        </span>
      ),
    },
  ];

  const consumedColumns = [
    {
      key: "item_name",
      header: "Part / Consumable",
      className:
        "min-w-[320px] text-slate-700",
    },
    {
      key: "qty",
      header: "Consumed",
      align: "right",
      className:
        "whitespace-nowrap font-mono font-bold text-slate-900",
    },
  ];

  const equipmentFailureColumns = [
    {
      key: "equipment",
      header: "Equipment",
      render: (row) => (
        <div className="min-w-[340px]">
          <div className="font-medium text-slate-900">
            {row.equipment.name ||
              row.equipment.category}
          </div>
          <div className="font-mono text-xs text-slate-500">
            SAP{" "}
            {row.equipment.sap_no}
          </div>
        </div>
      ),
    },
    {
      key: "count",
      header: "Failures",
      align: "right",
      render: (row) => (
        <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono font-bold text-red-600">
          <TrendingUp className="h-3.5 w-3.5" />
          {row.count}
        </span>
      ),
    },
  ];

  const lowStockColumns = [
    {
      key: "item_name",
      header: "Item",
      render: (item) => (
        <div className="min-w-[260px] font-medium text-slate-900">
          {item.item_name}
        </div>
      ),
    },
    {
      key: "item_code",
      header: "Item Code",
      className:
        "whitespace-nowrap font-mono text-xs text-slate-500",
    },
    {
      key: "storage_location",
      header: "Location",
      className:
        "min-w-[130px] text-slate-600",
    },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      render: (item) => (
        <span className="whitespace-nowrap font-mono font-bold text-red-600">
          {item.stock}
        </span>
      ),
    },
    {
      key: "min_stock",
      header: "Min.",
      align: "right",
      className:
        "whitespace-nowrap font-mono text-slate-500",
    },
    {
      key: "unit",
      header: "Unit",
      className:
        "whitespace-nowrap font-mono text-slate-500",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Maintenance operations at a glance"
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat
          icon={HardHat}
          label="Total Equipment"
          value={d.total_equipment}
          testId="stat-total"
          onClick={() =>
            nav("/equipment")
          }
        />

        <Stat
          icon={CheckCircle2}
          label="Green Tag / Ready"
          value={d.operational}
          tone="green"
          onClick={() =>
            nav(
              "/equipment?status=Operational"
            )
          }
        />

        <Stat
          icon={Wrench}
          label="Red Tag / Under Maintenance"
          value={
            d.under_maintenance
          }
          tone="red"
          onClick={() =>
            nav(
              "/equipment?status=Under%20Maintenance"
            )
          }
        />

        <Stat
          icon={Building}
          label="At Base"
          value={d.at_base}
          onClick={() =>
            nav(
              "/equipment?placement=Base"
            )
          }
        />

        <Stat
          icon={Warehouse}
          label="At Workshop"
          value={d.at_workshop}
          tone="violet"
          onClick={() =>
            nav(
              "/equipment?placement=Workshop"
            )
          }
        />

        <Stat
          icon={Briefcase}
          label="On Job"
          value={d.on_job}
          tone="blue"
          onClick={() =>
            nav(
              "/equipment?placement=Job"
            )
          }
        />

        <Stat
          icon={Truck}
          label="In Transit"
          value={d.in_transit}
          tone="orange"
          onClick={() =>
            nav(
              "/equipment?placement=Transit"
            )
          }
        />

        <Stat
          icon={Briefcase}
          label="Active Jobs"
          value={d.active_jobs}
          tone="blue"
          onClick={() =>
            nav("/jobs")
          }
        />

        <Stat
          icon={CalendarClock}
          label="Maint. This Month"
          value={
            d.maintenance_this_month
          }
          onClick={() =>
            nav("/maintenance")
          }
        />

        <Stat
          icon={Wrench}
          label="Open Maintenance"
          value={d.open_maintenance}
          tone="amber"
          onClick={() =>
            nav(
              "/maintenance?status=Open"
            )
          }
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
          onClick={() =>
            nav(
              "/inventory?low=1"
            )
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel
          title="Recent Maintenance"
          className="min-w-0 overflow-hidden lg:col-span-2"
        >
          <DashboardTable
            data={
              d.recent_maintenance
            }
            columns={recentColumns}
            minWidth="760px"
            emptyText="No maintenance yet"
            testIdPrefix="dash-recent"
            onRowClick={(mnt) =>
              nav(
                `/equipment/${mnt.equipment_id}`
              )
            }
          />
        </Panel>

        <div className="min-w-0 space-y-6">
          <Panel
            title="Most Common Failures"
            className="min-w-0 overflow-hidden"
          >
            <DashboardTable
              data={
                d.most_common_failures
              }
              columns={failureColumns}
              minWidth="520px"
              emptyText="No failures logged"
              testIdPrefix="dash-failures"
            />
          </Panel>

          <Panel
            title="Most Consumed Parts"
            className="min-w-0 overflow-hidden"
          >
            <DashboardTable
              data={
                d.most_consumed_parts
              }
              columns={
                consumedColumns
              }
              minWidth="500px"
              emptyText="No parts consumed"
              testIdPrefix="dash-consumed"
            />
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title="Equipment With Most Failures"
          className="min-w-0 overflow-hidden"
        >
          <DashboardTable
            data={
              d.equipment_most_failures
            }
            columns={
              equipmentFailureColumns
            }
            minWidth="560px"
            emptyText="No failures logged"
            testIdPrefix="dash-eq-failures"
            onRowClick={(row) =>
              nav(
                `/equipment/${row.equipment.id}`
              )
            }
          />
        </Panel>

        <Panel
          title="Low Stock Items"
          className="min-w-0 overflow-hidden"
        >
          <DashboardTable
            data={d.low_stock_items}
            columns={lowStockColumns}
            minWidth="760px"
            maxHeight="320px"
            emptyText="All stock levels healthy"
            testIdPrefix="dash-low-stock"
            onRowClick={() =>
              nav(
                "/inventory?low=1"
              )
            }
          />
        </Panel>
      </div>
    </div>
  );
}
