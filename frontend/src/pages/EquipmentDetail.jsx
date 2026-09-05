import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Wrench,
  AlertTriangle,
  Package,
  Briefcase,
  FileText,
  MapPin,
  Plus,
  CheckCircle2,
  RotateCcw,
  Move,
  Trash2,
  ExternalLink,
  Pencil,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";

import { api, API, formatApiError } from "@/lib/api";
import {
  useAuth,
  canEdit,
  canManage,
} from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import {
  PageHeader,
  Btn,
  EmptyState,
  Field,
  Panel,
  SelectInput,
} from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime } from "@/lib/helpers";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import MaintenanceDialog from "@/components/MaintenanceDialog";
import MaintenanceDocuments from "@/components/MaintenanceDocuments";
import JobLocationFields from "@/components/JobLocationFields";


function MntCard({
  m,
  equipmentId,
  documents,
  onDocumentsChanged,
  onClose,
  onReopen,
  onEdit,
  onDelete,
  canEditUser,
  canManageUser,
}) {
  const { format } = useCurrency();

  const maintenanceParts = m.parts_consumed || [];
  const purchaseParts = maintenanceParts.filter(
    (p) => (p.supply_source || "Ex-Stock") === "Purchase"
  );
  const purchaseTotal = purchaseParts.reduce(
    (sum, p) => sum + Number(p.cost || 0),
    0
  );

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-4"
      data-testid={`mnt-card-${m.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-blue-600">
              {m.mnt_no}
            </span>
            <StatusBadge value={m.status} />
            {m.type_of_maintenance && (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {m.type_of_maintenance}
              </span>
            )}
          </div>

          <div className="mt-1 font-mono text-xs text-slate-400">
            {fmtDate(m.maintenance_date)}
            {m.date_closed
              ? ` → ${fmtDate(m.date_closed)}`
              : ""}
            {" · "}
            {m.duration_days || 0}d
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`${API}/maintenance/${m.id}/report.pdf`}
            target="_blank"
            rel="noreferrer"
            data-testid={`pdf-${m.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </a>

          {m.status === "Open" && canEditUser && (
            <Btn
              onClick={() => onClose(m)}
              className="py-1.5 text-xs"
              data-testid={`close-${m.id}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Close
            </Btn>
          )}

          {m.status === "Open" && canEditUser && (
            <Btn
              variant="outline"
              onClick={() => onEdit(m)}
              className="py-1.5 text-xs"
              data-testid={`edit-mnt-${m.id}`}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Btn>
          )}

          {m.status === "Closed" && canManageUser && (
            <Btn
              variant="outline"
              onClick={() => onReopen(m)}
              className="py-1.5 text-xs"
              data-testid={`reopen-${m.id}`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reopen
            </Btn>
          )}

          {canManageUser && (
            <Btn
              variant="danger"
              onClick={() => onDelete(m)}
              className="py-1.5 text-xs"
              data-testid={`delete-mnt-${m.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Btn>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Problem / Damage"
          value={m.problem_damage}
        />
        <Field
          label="Failure Found"
          value={m.failure_found}
        />
        <Field
          label="Root Cause"
          value={m.root_cause}
        />
        <Field
          label="Action Taken"
          value={m.action_taken}
          className="sm:col-span-2 lg:col-span-1"
        />
        <Field
          label="Lead Technician"
          value={m.lead_technician}
        />
        <Field
          label="Support"
          value={(m.support_technicians || []).join(", ")}
        />
        <Field
          label="Checked By"
          value={m.checked_by}
        />
        <Field
          label="Final Condition"
          value={m.final_condition}
        />
        {m.job_number && (
          <Field
            label="Client / Job"
            value={`${m.client_name || ""} · ${m.job_number}`}
          />
        )}
      </div>

      {maintenanceParts.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Parts & Consumables
            </div>

            {purchaseParts.length > 0 && (
              <div
                className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700"
                data-testid={`mnt-cost-${m.id}`}
              >
                <DollarSign className="h-3.5 w-3.5" />
                Purchase total:
                <span className="font-mono">
                  {format(purchaseTotal)}
                </span>
              </div>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-2">
            {maintenanceParts.map((p, i) => {
              const source = p.supply_source || "Ex-Stock";
              const isPurchase = source === "Purchase";

              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-mono text-slate-700"
                >
                  {p.item_name} × {p.qty} {p.unit}
                  <span className="text-slate-400">
                    · {source}
                  </span>
                  {isPurchase && (
                    <span className="font-semibold text-blue-700">
                      · {format(Number(p.cost || 0))}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {m.notes && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Notes
          </div>
          <div className="mt-0.5 text-sm text-slate-700">
            {m.notes}
          </div>
        </div>
      )}

      <MaintenanceDocuments
        maintenance={m}
        equipmentId={equipmentId}
        documents={documents}
        canEditUser={canEditUser}
        onChanged={onDocumentsChanged}
      />
    </div>
  );
}


function equipmentLocationLabel(
  equipment,
  assignments = [],
  jobs = []
) {
  if (!equipment) return "—";

  const placement = equipment.placement || "Base";
  const detail = (equipment.placement_detail || "").trim();

  if (placement === "Job") {
    const activeAssignment = assignments.find(
      (item) => item.status === "Active"
    );

    const jobId =
      equipment.current_job_id ||
      activeAssignment?.job_id;

    const job = jobs.find(
      (item) => item.id === jobId
    );

    const client =
      job?.client_name ||
      activeAssignment?.client_name ||
      "";

    const site = job?.site_location || "";

    return [
      "Job",
      client,
      site,
    ]
      .filter(Boolean)
      .join(" - ");
  }

  if (
    !detail ||
    detail.toLowerCase() === placement.toLowerCase()
  ) {
    return placement;
  }

  return `${placement} - ${detail}`;
}


export default function EquipmentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();

  const [data, setData] = useState(null);
  const [mntDlg, setMntDlg] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [closeTarget, setCloseTarget] = useState(null);
  const [moveDlg, setMoveDlg] = useState(false);
  const [movePlacement, setMovePlacement] =
    useState("Base");
  const [moveReason, setMoveReason] = useState("");
  const [jobs, setJobs] = useState([]);
  const [moveJob, setMoveJob] = useState({
    job_id: "",
    client_id: "",
    site_location: "",
  });

  const load = useCallback(async () => {
    const { data } = await api.get(`/equipment/${id}`);
    setData(data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get("/jobs")
      .then((response) => setJobs(response.data || []))
      .catch(() => setJobs([]));
  }, []);

  const openMoveDialog = () => {
    const equipment = data?.equipment;
    const assignments = data?.assignments || [];
    const activeAssignment = assignments.find(
      (item) => item.status === "Active"
    );

    const currentJobId =
      equipment?.current_job_id ||
      activeAssignment?.job_id ||
      "";

    const currentJob = jobs.find(
      (item) => item.id === currentJobId
    );

    setMovePlacement(
      equipment?.placement === "Job"
        ? "Job"
        : "Base"
    );

    setMoveJob({
      job_id: currentJobId,
      client_id:
        currentJob?.client_id ||
        activeAssignment?.client_id ||
        "",
      site_location:
        currentJob?.site_location || "",
    });

    setMoveReason("");
    setMoveDlg(true);
  };

  const reopen = async (m) => {
    try {
      await api.post(`/maintenance/${m.id}/reopen`);
      toast.success("Reopened; stock restored");
      load();
    } catch (e) {
      toast.error(
        formatApiError(e.response?.data?.detail)
      );
    }
  };

  const delMnt = async (m) => {
    if (
      !window.confirm(
        `Delete maintenance ${m.mnt_no}? This also removes its failures and restores any consumed stock.`
      )
    ) {
      return;
    }

    try {
      await api.delete(`/maintenance/${m.id}`);
      toast.success("Maintenance deleted");
      load();
    } catch (e) {
      toast.error(
        formatApiError(e.response?.data?.detail)
      );
    }
  };

  const doMove = async () => {
    const activeAssignment = (
      data?.assignments || []
    ).find((item) => item.status === "Active");

    try {
      if (movePlacement === "Base") {
        if (activeAssignment) {
          await api.post(
            `/assignments/${activeAssignment.id}/demobilize`,
            {
              return_placement: "Base",
            }
          );
        } else {
          await api.post(`/equipment/${id}/move`, {
            placement: "Base",
            placement_detail: "Base",
            reason: moveReason,
          });
        }

        toast.success("Equipment moved to Base");
      } else {
        if (!moveJob.job_id) {
          toast.error("Select a Job first");
          return;
        }

        if (
          activeAssignment?.job_id ===
          moveJob.job_id
        ) {
          toast.info(
            "Equipment is already assigned to this Job"
          );
          setMoveDlg(false);
          return;
        }

        if (activeAssignment) {
          await api.post(
            `/assignments/${activeAssignment.id}/demobilize`,
            {
              return_placement: "Base",
            }
          );
        }

        await api.post(
          `/jobs/${moveJob.job_id}/assign`,
          {
            equipment_id: id,
          }
        );

        toast.success("Equipment assigned to Job");
      }

      setMoveDlg(false);
      setMoveReason("");
      await load();
    } catch (e) {
      toast.error(
        formatApiError(e.response?.data?.detail)
      );
    }
  };

  if (!data) {
    return (
      <div className="text-slate-400">
        Loading equipment…
      </div>
    );
  }

  const {
    equipment: eq,
    maintenance = [],
    failures = [],
    recurring_failures = [],
    location_history = [],
    assignments = [],
    documents = [],
    parts_consumption = [],
  } = data;

  const currentLocation = equipmentLocationLabel(
    eq,
    assignments,
    jobs
  );

  const documentsByMaintenance = documents.reduce(
    (acc, file) => {
      if (!file.maintenance_id) return acc;
      if (!acc[file.maintenance_id]) {
        acc[file.maintenance_id] = [];
      }
      acc[file.maintenance_id].push(file);
      return acc;
    },
    {}
  );

  const maintenanceById = maintenance.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {}
  );

  const documentRows = [...documents].sort((a, b) => {
    const ma = maintenanceById[a.maintenance_id];
    const mb = maintenanceById[b.maintenance_id];
    const dateA =
      ma?.maintenance_date || a.created_at || "";
    const dateB =
      mb?.maintenance_date || b.created_at || "";
    return String(dateB).localeCompare(String(dateA));
  });

  return (
    <div>
      <button
        onClick={() => nav("/equipment")}
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Equipment
      </button>

      <PageHeader
        title={eq.name || eq.category || eq.sap_no}
        subtitle={`SAP ${eq.sap_no}  ·  Mfg ${
          eq.mfg_no || "—"
        }  ·  ${eq.manufacturer || ""}`}
        testId="equipment-detail-header"
      >
        {canManage(user) && (
          <Btn
            variant="outline"
            onClick={openMoveDialog}
            data-testid="move-btn"
          >
            <Move className="h-4 w-4" />
            Change Location
          </Btn>
        )}

        {canEdit(user) && (
          <Btn
            onClick={() => setMntDlg(true)}
            data-testid="new-maintenance-btn"
          >
            <Plus className="h-4 w-4" />
            New Maintenance
          </Btn>
        )}
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Current Location
          </div>
          <div className="mt-1 flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <span className="font-semibold text-slate-900">
              {currentLocation}
            </span>
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Operational Status
          </div>
          <div className="mt-2">
            <StatusBadge value={eq.operational_status} />
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Maintenance Records
          </div>
          <div className="mt-1 font-mono text-2xl font-bold">
            {maintenance.length}
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Failures Logged
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600">
            {failures.length}
          </div>
        </Panel>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex flex-wrap">
          <TabsTrigger
            value="overview"
            data-testid="tab-overview"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="maintenance"
            data-testid="tab-maintenance"
          >
            Maintenance History
          </TabsTrigger>
          <TabsTrigger
            value="failures"
            data-testid="tab-failures"
          >
            Failure History
          </TabsTrigger>
          <TabsTrigger
            value="parts"
            data-testid="tab-parts"
          >
            Parts & Consumables
          </TabsTrigger>
          <TabsTrigger
            value="jobs"
            data-testid="tab-jobs"
          >
            Job History
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            data-testid="tab-documents"
          >
            Documents
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel
              title="Equipment Information"
              className="lg:col-span-2"
            >
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="Asset / SAP No."
                  value={eq.sap_no}
                  mono
                />
                <Field
                  label="Serial / Mfg No."
                  value={eq.mfg_no}
                  mono
                />
                <Field
                  label="Equipment Type"
                  value={eq.name}
                />
                <Field
                  label="Category"
                  value={eq.category}
                />
                <Field
                  label="Manufacturer"
                  value={eq.manufacturer}
                />
                <Field
                  label="Date of Purchase"
                  value={fmtDate(eq.date_of_purchase)}
                  mono
                />
                <Field
                  label="Physical Condition"
                  value={eq.physical_condition}
                />
                <Field
                  label="Current Location"
                  value={currentLocation}
                />
                <Field
                  label="Operational Status"
                  value={eq.operational_status}
                />
              </div>
            </Panel>

            <Panel title="Location / Assignment History">
              <div className="max-h-[22rem] divide-y divide-slate-100 overflow-auto">
                {location_history.length ? (
                  location_history.map((h) => (
                    <div
                      key={h.id}
                      className="px-4 py-3"
                      data-testid={`loc-${h.id}`}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        {h.from_placement && (
                          <span className="text-slate-400">
                            {h.from_placement} →
                          </span>
                        )}{" "}
                        {h.to_placement}
                      </div>
                      <div className="text-xs text-slate-500">
                        {h.reason}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {fmtDateTime(h.created_at)} ·{" "}
                        {h.created_by}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={MapPin}
                    text="No movement history"
                  />
                )}
              </div>
            </Panel>
          </div>
        </TabsContent>

        {/* MAINTENANCE */}
        <TabsContent value="maintenance">
          <div className="space-y-4">
            {maintenance.length ? (
              maintenance.map((m) => (
                <MntCard
                  key={m.id}
                  m={m}
                  equipmentId={eq.id}
                  documents={
                    documentsByMaintenance[m.id] || []
                  }
                  onDocumentsChanged={load}
                  canEditUser={canEdit(user)}
                  canManageUser={canManage(user)}
                  onClose={(mm) => {
                    setCloseTarget(mm);
                  }}
                  onReopen={reopen}
                  onEdit={(mm) => setEditTarget(mm)}
                  onDelete={delMnt}
                />
              ))
            ) : (
              <EmptyState
                icon={Wrench}
                text="No maintenance records yet"
              />
            )}
          </div>
        </TabsContent>

        {/* FAILURES */}
        <TabsContent value="failures">
          <div className="space-y-4">
            {recurring_failures.length > 0 && (
              <Panel title="Recurring Failures">
                <div className="divide-y divide-slate-100">
                  {recurring_failures.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-4 py-3"
                      data-testid={`recurring-${i}`}
                    >
                      <span className="text-sm font-medium text-slate-900">
                        {f.failure_name}
                      </span>
                      <span
                        className={`font-mono text-sm font-bold ${
                          f.count >= 2
                            ? "text-red-600"
                            : "text-slate-500"
                        }`}
                      >
                        {f.count} occurrence
                        {f.count > 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="All Failures (newest first)">
              <div className="divide-y divide-slate-100">
                {failures.length ? (
                  failures.map((f) => (
                    <div
                      key={f.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                      data-testid={`failure-${f.id}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900">
                          {f.failure_name}
                        </div>
                        {f.root_cause && (
                          <div className="text-xs text-slate-500">
                            Root cause: {f.root_cause}
                          </div>
                        )}
                        <div className="font-mono text-[11px] text-slate-400">
                          {fmtDate(f.occurred_date)}
                        </div>
                      </div>

                      {f.mnt_no && (
                        <span className="font-mono text-xs text-blue-600">
                          {f.mnt_no}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <EmptyState
                    icon={AlertTriangle}
                    text="No failures logged"
                  />
                )}
              </div>
            </Panel>
          </div>
        </TabsContent>

        {/* PARTS */}
        <TabsContent value="parts">
          <Panel title="Parts & Consumables Consumption History">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3 text-right">
                      Qty
                    </th>
                    <th className="px-4 py-3">
                      Maintenance
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {parts_consumption.map((p) => (
                    <tr
                      key={p.id}
                      data-testid={`consumption-${p.id}`}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                        {fmtDate(p.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-900">
                        {p.item_name}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-500">
                        {p.item_code}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold">
                        {p.qty} {p.unit}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-blue-600">
                        {p.mnt_no}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parts_consumption.length === 0 && (
              <EmptyState
                icon={Package}
                text="No parts consumed on this equipment"
              />
            )}
          </Panel>
        </TabsContent>

        {/* JOBS */}
        <TabsContent value="jobs">
          <Panel title="Job Assignment History">
            <div className="divide-y divide-slate-100">
              {assignments.length ? (
                assignments.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                    data-testid={`assignment-${a.id}`}
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/jobs/${a.job_id}`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {a.job_number}
                      </Link>
                      <span className="ml-2 text-sm text-slate-700">
                        {a.client_name}
                      </span>
                      <div className="font-mono text-xs text-slate-500">
                        Mobilized{" "}
                        {fmtDate(a.mobilization_date)}
                        {a.demobilization_date
                          ? ` · Demob ${fmtDate(
                              a.demobilization_date
                            )} → ${a.return_placement}`
                          : ""}
                      </div>
                    </div>

                    <StatusBadge value={a.status} />
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={Briefcase}
                  text="Never assigned to a job (Base/Workshop only)"
                />
              )}
            </div>
          </Panel>
        </TabsContent>

        {/* DOCUMENTS */}
        <TabsContent value="documents">
          <Panel title="Maintenance Documents">
            <div className="border-b border-slate-100 px-4 py-3 text-xs leading-5 text-slate-500">
              Documents are uploaded from each maintenance record.
              This tab is an equipment-level index of all maintenance
              attachments.
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">
                      Maintenance ID
                    </th>
                    <th className="px-4 py-3">
                      Type
                    </th>
                    <th className="px-4 py-3">
                      Date
                    </th>
                    <th className="px-4 py-3">
                      Document Type
                    </th>
                    <th className="px-4 py-3">
                      File
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {documentRows.map((file) => {
                    const m =
                      maintenanceById[file.maintenance_id];

                    return (
                      <tr
                        key={file.id}
                        data-testid={`doc-${file.id}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-600">
                          {m?.mnt_no ||
                            "Unassigned / Legacy"}
                        </td>

                        <td className="px-4 py-3 text-slate-700">
                          {m?.type_of_maintenance || "—"}
                        </td>

                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {fmtDate(
                            m?.maintenance_date ||
                              file.created_at
                          )}
                        </td>

                        <td className="px-4 py-3 text-slate-700">
                          {file.doc_type || "Document"}
                        </td>

                        <td className="px-4 py-3">
                          <a
                            href={`${API}/files/${file.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[320px] items-center gap-2 text-blue-600 hover:underline"
                          >
                            <FileText className="h-4 w-4 shrink-0" />
                            <span className="truncate">
                              {file.original_filename}
                            </span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {documentRows.length === 0 && (
              <EmptyState
                icon={FileText}
                text="No maintenance documents uploaded"
              />
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      <MaintenanceDialog
        open={mntDlg}
        onOpenChange={setMntDlg}
        equipment={eq}
        mode="create"
        onSaved={load}
      />

      <MaintenanceDialog
        open={!!editTarget}
        onOpenChange={(open) =>
          !open && setEditTarget(null)
        }
        equipment={eq}
        mode="edit"
        maintenance={editTarget}
        onSaved={load}
      />

      <MaintenanceDialog
        open={!!closeTarget}
        onOpenChange={(open) =>
          !open && setCloseTarget(null)
        }
        equipment={eq}
        mode="close"
        maintenance={closeTarget}
        onSaved={load}
      />

      <Dialog
        open={moveDlg}
        onOpenChange={setMoveDlg}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Change Location
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-slate-500">
            Record a physical placement move. This preserves
            the full location history.
          </p>

          <SelectInput
            label="New Location"
            value={movePlacement}
            onChange={(e) => {
              const next = e.target.value;
              setMovePlacement(next);

              if (next === "Base") {
                setMoveJob({
                  job_id: "",
                  client_id: "",
                  site_location: "",
                });
              }
            }}
            data-testid="move-placement"
          >
            <option>Base</option>
            <option>Job</option>
          </SelectInput>

          {movePlacement === "Job" && (
            <JobLocationFields
              jobs={jobs}
              value={moveJob}
              onChange={setMoveJob}
            />
          )}

          {movePlacement === "Base" && (
            <input
              placeholder="Reason (optional)"
              value={moveReason}
              onChange={(e) =>
                setMoveReason(e.target.value)
              }
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              data-testid="move-reason"
            />
          )}

          <p className="text-xs leading-5 text-slate-400">
            Job location uses the existing assignment workflow,
            so Job, Client, Site, and assignment history stay synchronized.
          </p>

          <DialogFooter>
            <Btn
              variant="outline"
              onClick={() => setMoveDlg(false)}
            >
              Cancel
            </Btn>
            <Btn
              onClick={doMove}
              data-testid="confirm-move"
            >
              Move
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
