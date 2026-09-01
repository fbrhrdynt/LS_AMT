import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, LogOut, HardHat, Wrench, AlertTriangle, Package } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth, canManage } from "@/context/AuthContext";
import { PageHeader, Btn, EmptyState, Field, Panel, SelectInput, TextInput } from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function JobDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [assignDlg, setAssignDlg] = useState(false);
  const [eqQuery, setEqQuery] = useState("");
  const [eqResults, setEqResults] = useState([]);
  const [demob, setDemob] = useState(null);
  const [returnPlacement, setReturnPlacement] = useState("Base");

  const load = useCallback(async () => {
    const { data } = await api.get(`/jobs/${id}`); setData(data);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!assignDlg) return;
    const t = setTimeout(async () => {
      const { data } = await api.get(`/equipment?q=${encodeURIComponent(eqQuery)}&page_size=8`);
      setEqResults(data.items);
    }, 200);
    return () => clearTimeout(t);
  }, [eqQuery, assignDlg]);

  const assign = async (equipment_id) => {
    try {
      await api.post(`/jobs/${id}/assign`, { equipment_id });
      toast.success("Equipment mobilized to job"); setAssignDlg(false); setEqQuery(""); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const doDemob = async () => {
    try {
      await api.post(`/assignments/${demob.id}/demobilize`, { return_placement: returnPlacement });
      toast.success("Equipment demobilized"); setDemob(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  if (!data) return <div className="text-slate-400">Loading…</div>;
  const { job, assignments, equipment, maintenance, failures, parts_consumption } = data;
  const eqMap = Object.fromEntries(equipment.map((e) => [e.id, e]));

  return (
    <div>
      <button onClick={() => nav("/jobs")} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Jobs</button>
      <PageHeader title={job.job_name} subtitle={`${job.job_number} · ${job.client_name}`}>
        <StatusBadge value={job.status} />
        {canManage(user) && <Btn onClick={() => setAssignDlg(true)} data-testid="assign-equipment-btn"><Plus className="h-4 w-4" /> Assign Equipment</Btn>}
      </PageHeader>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex flex-wrap">
          <TabsTrigger value="overview" data-testid="jtab-overview">Overview</TabsTrigger>
          <TabsTrigger value="equipment" data-testid="jtab-equipment">Equipment ({equipment.length})</TabsTrigger>
          <TabsTrigger value="maintenance" data-testid="jtab-maintenance">Maintenance ({maintenance.length})</TabsTrigger>
          <TabsTrigger value="failures" data-testid="jtab-failures">Failures ({failures.length})</TabsTrigger>
          <TabsTrigger value="parts" data-testid="jtab-parts">Parts ({parts_consumption.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Panel className="p-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Job Number" value={job.job_number} mono />
              <Field label="Client" value={job.client_name} />
              <Field label="Site / Location" value={job.site_location} />
              <Field label="Start Date" value={fmtDate(job.start_date)} mono />
              <Field label="End Date" value={fmtDate(job.end_date)} mono />
              <Field label="Status" value={job.status} />
              <Field label="Notes" value={job.notes} className="sm:col-span-2 lg:col-span-3" />
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="equipment">
          <Panel>
            <div className="divide-y divide-slate-100">
              {assignments.length ? assignments.map((a) => {
                const eq = eqMap[a.equipment_id];
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`assign-row-${a.id}`}>
                    <button onClick={() => eq && nav(`/equipment/${a.equipment_id}`)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-medium text-slate-900">{a.equipment_name || a.sap_no}</div>
                      <div className="font-mono text-xs text-slate-500">SAP {a.sap_no} · Mobilized {fmtDate(a.mobilization_date)}{a.demobilization_date ? ` · Demob ${fmtDate(a.demobilization_date)}` : ""}</div>
                    </button>
                    <StatusBadge value={a.status} />
                    {canManage(user) && a.status === "Active" && (
                      <Btn variant="outline" onClick={() => { setDemob(a); setReturnPlacement("Base"); }} data-testid={`demob-${a.id}`}><LogOut className="h-4 w-4" /> Demobilize</Btn>
                    )}
                  </div>
                );
              }) : <EmptyState icon={HardHat} text="No equipment assigned" />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="maintenance">
          <Panel>
            <div className="divide-y divide-slate-100">
              {maintenance.length ? maintenance.map((m) => (
                <button key={m.id} onClick={() => nav(`/equipment/${m.equipment_id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <span className="font-mono text-xs text-blue-600 w-28">{m.mnt_no}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm text-slate-900">{m.equipment_name}</div><div className="truncate text-xs text-slate-500">{m.problem_damage}</div></div>
                  <StatusBadge value={m.status} />
                </button>
              )) : <EmptyState icon={Wrench} text="No maintenance on this job" />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="failures">
          <Panel>
            <div className="divide-y divide-slate-100">
              {failures.length ? failures.map((f) => (
                <div key={f.id} className="px-4 py-3"><div className="text-sm font-medium text-slate-900">{f.failure_name}</div><div className="font-mono text-xs text-slate-500">{f.mnt_no} · {fmtDate(f.occurred_date)}</div></div>
              )) : <EmptyState icon={AlertTriangle} text="No failures" />}
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="parts">
          <Panel>
            <div className="divide-y divide-slate-100">
              {parts_consumption.length ? parts_consumption.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3"><div><div className="text-sm text-slate-900">{p.item_name}</div><div className="font-mono text-xs text-slate-500">{p.item_code} · {p.mnt_no}</div></div><span className="font-mono text-sm font-bold">{p.qty} {p.unit}</span></div>
              )) : <EmptyState icon={Package} text="No parts consumed" />}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <Dialog open={assignDlg} onOpenChange={setAssignDlg}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Assign Equipment to {job.job_number}</DialogTitle></DialogHeader>
          <TextInput placeholder="Search equipment by SAP / Serial / Name…" value={eqQuery} onChange={(e) => setEqQuery(e.target.value)} data-testid="assign-search" />
          <div className="max-h-72 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200">
            {eqResults.map((e) => (
              <button key={e.id} onClick={() => assign(e.id)} disabled={e.placement === "Job"} data-testid={`assign-pick-${e.id}`}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50">
                <div><div className="text-sm text-slate-900">{e.name || e.category}</div><div className="font-mono text-xs text-slate-500">SAP {e.sap_no}</div></div>
                <StatusBadge value={e.placement} />
              </button>
            ))}
            {eqResults.length === 0 && <div className="px-3 py-4 text-sm text-slate-400">No equipment found</div>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!demob} onOpenChange={(o) => !o && setDemob(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Demobilize {demob?.sap_no}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Record demobilization and return the equipment to its resting location.</p>
          <SelectInput label="Return To" value={returnPlacement} onChange={(e) => setReturnPlacement(e.target.value)} data-testid="return-placement">
            <option>Base</option><option>Workshop</option><option>Transit</option>
          </SelectInput>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setDemob(null)}>Cancel</Btn>
            <Btn onClick={doDemob} data-testid="confirm-demob">Demobilize</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
