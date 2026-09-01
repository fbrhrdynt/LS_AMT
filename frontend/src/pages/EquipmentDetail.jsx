import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Wrench, AlertTriangle, Package, Briefcase, FileText, MapPin,
  Plus, CheckCircle2, RotateCcw, Upload, Move, Trash2, Download, ExternalLink, Pencil, DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { api, API, formatApiError } from "@/lib/api";
import { useAuth, canEdit, canManage } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import { PageHeader, Btn, EmptyState, Field, Panel, SelectInput } from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime } from "@/lib/helpers";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import MaintenanceDialog from "@/components/MaintenanceDialog";

function MntCard({ m, onClose, onReopen, onEdit, onDelete, canEditUser, canManageUser }) {
  const { format } = useCurrency();
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid={`mnt-card-${m.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-blue-600">{m.mnt_no}</span>
            <StatusBadge value={m.status} />
            {m.type_of_maintenance && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{m.type_of_maintenance}</span>}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-400">{fmtDate(m.maintenance_date)}{m.date_closed ? ` → ${fmtDate(m.date_closed)}` : ""} · {m.duration_days || 0}d</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`${API}/maintenance/${m.id}/report.pdf`} target="_blank" rel="noreferrer" data-testid={`pdf-${m.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><FileText className="h-3.5 w-3.5" /> PDF</a>
          {m.status === "Open" && canEditUser && <Btn onClick={() => onClose(m)} className="py-1.5 text-xs" data-testid={`close-${m.id}`}><CheckCircle2 className="h-3.5 w-3.5" /> Close</Btn>}
          {m.status === "Open" && canEditUser && <Btn variant="outline" onClick={() => onEdit(m)} className="py-1.5 text-xs" data-testid={`edit-mnt-${m.id}`}><Pencil className="h-3.5 w-3.5" /> Edit</Btn>}
          {m.status === "Closed" && canManageUser && <Btn variant="outline" onClick={() => onReopen(m)} className="py-1.5 text-xs" data-testid={`reopen-${m.id}`}><RotateCcw className="h-3.5 w-3.5" /> Reopen</Btn>}
          {canManageUser && <Btn variant="danger" onClick={() => onDelete(m)} className="py-1.5 text-xs" data-testid={`delete-mnt-${m.id}`}><Trash2 className="h-3.5 w-3.5" /></Btn>}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Problem / Damage" value={m.problem_damage} />
        <Field label="Failure Found" value={m.failure_found} />
        <Field label="Root Cause" value={m.root_cause} />
        <Field label="Action Taken" value={m.action_taken} className="sm:col-span-2 lg:col-span-1" />
        <Field label="Lead Technician" value={m.lead_technician} />
        <Field label="Support" value={(m.support_technicians || []).join(", ")} />
        <Field label="Checked By" value={m.checked_by} />
        <Field label="Final Condition" value={m.final_condition} />
        {m.job_number && <Field label="Client / Job" value={`${m.client_name || ""} · ${m.job_number}`} />}
      </div>
      {(m.parts_consumed || []).length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Parts & Consumables</div>
            {m.total_cost > 0 && (
              <div className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700" data-testid={`mnt-cost-${m.id}`}>
                <DollarSign className="h-3.5 w-3.5" /> Total cost: <span className="font-mono">{format(m.total_cost)}</span>
              </div>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {m.parts_consumed.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-mono text-slate-700">{p.item_name} × {p.qty} {p.unit}{p.cost ? ` · ${format(p.cost)}` : ""}</span>
            ))}
          </div>
        </div>
      )}
      {m.notes && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Notes</div>
          <div className="mt-0.5 text-sm text-slate-700">{m.notes}</div>
        </div>
      )}
    </div>
  );
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
  const [movePlacement, setMovePlacement] = useState("Workshop");
  const [moveReason, setMoveReason] = useState("");
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState("Document");

  const load = useCallback(async () => {
    const { data } = await api.get(`/equipment/${id}`); setData(data);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const reopen = async (m) => {
    try { await api.post(`/maintenance/${m.id}/reopen`); toast.success("Reopened; stock restored"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const delMnt = async (m) => {
    if (!window.confirm(`Delete maintenance ${m.mnt_no}? This also removes its failures and restores any consumed stock.`)) return;
    try { await api.delete(`/maintenance/${m.id}`); toast.success("Maintenance deleted"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const doMove = async () => {
    try {
      await api.post(`/equipment/${id}/move`, { placement: movePlacement, placement_detail: movePlacement, reason: moveReason });
      toast.success("Location updated"); setMoveDlg(false); setMoveReason(""); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("doc_type", docType); fd.append("equipment_id", id);
      await api.post("/files/upload", fd);
      toast.success("File uploaded"); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const delFile = async (fid) => {
    try { await api.delete(`/files/${fid}`); toast.success("Removed"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (!data) return <div className="text-slate-400">Loading equipment…</div>;
  const { equipment: eq, maintenance, failures, recurring_failures, location_history, assignments, documents, parts_consumption } = data;

  return (
    <div>
      <button onClick={() => nav("/equipment")} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Equipment</button>
      <PageHeader title={eq.name || eq.category || eq.sap_no} subtitle={`SAP ${eq.sap_no}  ·  Mfg ${eq.mfg_no || "—"}  ·  ${eq.manufacturer || ""}`} testId="equipment-detail-header">
        {canManage(user) && <Btn variant="outline" onClick={() => setMoveDlg(true)} data-testid="move-btn"><Move className="h-4 w-4" /> Change Location</Btn>}
        {canEdit(user) && <Btn onClick={() => setMntDlg(true)} data-testid="new-maintenance-btn"><Plus className="h-4 w-4" /> New Maintenance</Btn>}
      </PageHeader>

      {/* current status strip */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Current Location</div>
          <div className="mt-1 flex items-center gap-2"><MapPin className="h-4 w-4 text-blue-600" /><span className="font-semibold text-slate-900">{eq.placement}</span></div>
          <div className="font-mono text-xs text-slate-500">{eq.placement_detail}</div></Panel>
        <Panel className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Operational Status</div>
          <div className="mt-2"><StatusBadge value={eq.operational_status} /></div></Panel>
        <Panel className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Maintenance Records</div>
          <div className="mt-1 font-mono text-2xl font-bold">{maintenance.length}</div></Panel>
        <Panel className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Failures Logged</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600">{failures.length}</div></Panel>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex flex-wrap">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="maintenance" data-testid="tab-maintenance">Maintenance History</TabsTrigger>
          <TabsTrigger value="failures" data-testid="tab-failures">Failure History</TabsTrigger>
          <TabsTrigger value="parts" data-testid="tab-parts">Parts & Consumables</TabsTrigger>
          <TabsTrigger value="jobs" data-testid="tab-jobs">Job History</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="Equipment Information" className="lg:col-span-2">
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Asset / SAP No." value={eq.sap_no} mono />
                <Field label="Serial / Mfg No." value={eq.mfg_no} mono />
                <Field label="Equipment Type" value={eq.name} />
                <Field label="Category" value={eq.category} />
                <Field label="Manufacturer" value={eq.manufacturer} />
                <Field label="Date of Purchase" value={fmtDate(eq.date_of_purchase)} mono />
                <Field label="Physical Condition" value={eq.physical_condition} />
                <Field label="Placement" value={`${eq.placement} — ${eq.placement_detail || ""}`} />
                <Field label="Operational Status" value={eq.operational_status} />
              </div>
            </Panel>
            <Panel title="Location / Assignment History">
              <div className="max-h-[22rem] divide-y divide-slate-100 overflow-auto">
                {location_history.length ? location_history.map((h) => (
                  <div key={h.id} className="px-4 py-3" data-testid={`loc-${h.id}`}>
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      {h.from_placement && <span className="text-slate-400">{h.from_placement} →</span>} {h.to_placement}
                    </div>
                    <div className="text-xs text-slate-500">{h.reason}</div>
                    <div className="font-mono text-[11px] text-slate-400">{fmtDateTime(h.created_at)} · {h.created_by}</div>
                  </div>
                )) : <EmptyState icon={MapPin} text="No movement history" />}
              </div>
            </Panel>
          </div>
        </TabsContent>

        {/* MAINTENANCE */}
        <TabsContent value="maintenance">
          <div className="space-y-4">
            {maintenance.length ? maintenance.map((m) => (
              <MntCard key={m.id} m={m} canEditUser={canEdit(user)} canManageUser={canManage(user)}
                onClose={(mm) => { setCloseTarget(mm); }} onReopen={reopen}
                onEdit={(mm) => setEditTarget(mm)} onDelete={delMnt} />
            )) : <EmptyState icon={Wrench} text="No maintenance records yet" />}
          </div>
        </TabsContent>

        {/* FAILURES */}
        <TabsContent value="failures">
          <div className="space-y-4">
            {recurring_failures.length > 0 && (
              <Panel title="Recurring Failures">
                <div className="divide-y divide-slate-100">
                  {recurring_failures.map((f, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3" data-testid={`recurring-${i}`}>
                      <span className="text-sm font-medium text-slate-900">{f.failure_name}</span>
                      <span className={`font-mono text-sm font-bold ${f.count >= 2 ? "text-red-600" : "text-slate-500"}`}>{f.count} occurrence{f.count > 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
            <Panel title="All Failures (newest first)">
              <div className="divide-y divide-slate-100">
                {failures.length ? failures.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`failure-${f.id}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">{f.failure_name}</div>
                      {f.root_cause && <div className="text-xs text-slate-500">Root cause: {f.root_cause}</div>}
                      <div className="font-mono text-[11px] text-slate-400">{fmtDate(f.occurred_date)}</div>
                    </div>
                    {f.mnt_no && <span className="font-mono text-xs text-blue-600">{f.mnt_no}</span>}
                  </div>
                )) : <EmptyState icon={AlertTriangle} text="No failures logged" />}
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
                  <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Code</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3">Maintenance</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parts_consumption.map((p) => (
                    <tr key={p.id} data-testid={`consumption-${p.id}`}>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{fmtDate(p.created_at)}</td>
                      <td className="px-4 py-2.5 text-slate-900">{p.item_name}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-500">{p.item_code}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold">{p.qty} {p.unit}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{p.mnt_no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parts_consumption.length === 0 && <EmptyState icon={Package} text="No parts consumed on this equipment" />}
          </Panel>
        </TabsContent>

        {/* JOBS */}
        <TabsContent value="jobs">
          <Panel title="Job Assignment History">
            <div className="divide-y divide-slate-100">
              {assignments.length ? assignments.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`assignment-${a.id}`}>
                  <div className="min-w-0">
                    <Link to={`/jobs/${a.job_id}`} className="text-sm font-medium text-blue-600 hover:underline">{a.job_number}</Link>
                    <span className="ml-2 text-sm text-slate-700">{a.client_name}</span>
                    <div className="font-mono text-xs text-slate-500">Mobilized {fmtDate(a.mobilization_date)}{a.demobilization_date ? ` · Demob ${fmtDate(a.demobilization_date)} → ${a.return_placement}` : ""}</div>
                  </div>
                  <StatusBadge value={a.status} />
                </div>
              )) : <EmptyState icon={Briefcase} text="Never assigned to a job (Base/Workshop only)" />}
            </div>
          </Panel>
        </TabsContent>

        {/* DOCUMENTS */}
        <TabsContent value="documents">
          <Panel title="Documents & Attachments" action={canEdit(user) && (
            <div className="flex items-center gap-2">
              <SelectInput value={docType} onChange={(e) => setDocType(e.target.value)} className="w-40">
                <option>Document</option><option>Before Photo</option><option>After Photo</option><option>Failure Evidence</option><option>PDF Report</option>
              </SelectInput>
              <Btn onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="upload-doc-btn"><Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload"}</Btn>
              <input ref={fileRef} type="file" className="hidden" onChange={upload} accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.csv,.txt,.xlsx,.doc,.docx" data-testid="doc-file-input" />
            </div>
          )}>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-md border border-slate-200 p-3" data-testid={`doc-${f.id}`}>
                  <FileText className="h-8 w-8 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{f.original_filename}</div>
                    <div className="text-xs text-slate-500">{f.doc_type} · {(f.size / 1024).toFixed(0)} KB</div>
                  </div>
                  <a href={`${API}/files/${f.id}/download`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-blue-600"><ExternalLink className="h-4 w-4" /></a>
                  {canEdit(user) && <button onClick={() => delFile(f.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
            {documents.length === 0 && <EmptyState icon={FileText} text="No documents uploaded" />}
          </Panel>
        </TabsContent>
      </Tabs>

      <MaintenanceDialog open={mntDlg} onOpenChange={setMntDlg} equipment={eq} mode="create" onSaved={load} />
      <MaintenanceDialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} equipment={eq} mode="edit" maintenance={editTarget} onSaved={load} />
      <MaintenanceDialog open={!!closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)} equipment={eq} mode="close" maintenance={closeTarget} onSaved={load} />

      <Dialog open={moveDlg} onOpenChange={setMoveDlg}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Change Location</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Record a physical placement move. This preserves the full location history.</p>
          <SelectInput label="New Placement" value={movePlacement} onChange={(e) => setMovePlacement(e.target.value)} data-testid="move-placement">
            <option>Base</option><option>Workshop</option><option>Transit</option>
          </SelectInput>
          <p className="text-xs text-slate-400">To place equipment on a Job, assign it from the Job page (this creates a proper assignment).</p>
          <input placeholder="Reason (optional)" value={moveReason} onChange={(e) => setMoveReason(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" data-testid="move-reason" />
          <DialogFooter>
            <Btn variant="outline" onClick={() => setMoveDlg(false)}>Cancel</Btn>
            <Btn onClick={doMove} data-testid="confirm-move">Move</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
