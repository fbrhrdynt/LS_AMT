import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth, canManage } from "@/context/AuthContext";
import { PageHeader, Btn, TextInput, TextArea, SelectInput } from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import DataTable from "@/components/DataTable";

const STATUSES = ["Active", "On Hold", "Completed", "Cancelled"];
const empty = { field_name: "", client_id: "", site_location: "", start_date: "", end_date: "", status: "Active", notes: "" };

export default function Jobs() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [clients, setClients] = useState([]);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    const [j, c] = await Promise.all([api.get("/jobs"), api.get("/clients")]);
    setJobs(j.data); setClients(c.data);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.field_name || !form.client_id) { toast.error("Field Name and Client are required"); return; }
    try {
      if (editing) await api.put(`/jobs/${editing.id}`, form);
      else await api.post("/jobs", form);
      toast.success(editing ? "Job updated" : "Job created");
      setDialog(false); setForm(empty); setEditing(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const openEdit = (j) => {
    setEditing(j);
    setForm({
      field_name: j.field_name || j.job_name || "",
      client_id: j.client_id,
      site_location: j.site_location || "",
      start_date: j.start_date || "",
      end_date: j.end_date || "",
      status: j.status || "Active",
      notes: j.notes || "",
    });
    setDialog(true);
  };

  const del = async (j) => {
    if (!window.confirm(`Delete job ${j.job_number}?`)) return;
    try { await api.delete(`/jobs/${j.id}`); toast.success("Job deleted"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Jobs" subtitle={`${jobs.length} jobs`}>
        {canManage(user) && <Btn onClick={() => { setEditing(null); setForm(empty); setDialog(true); }}><Plus className="h-4 w-4" /> Add Job</Btn>}
      </PageHeader>

      <DataTable
        data={jobs}
        searchKeys={["job_number", "field_name", "job_name", "client_name", "site_location", "notes"]}
        searchPlaceholder="Search Job ID, Client, Site, Field Name…"
        testIdPrefix="jobs"
        rowTestId={(j) => `job-row-${j.id}`}
        onRowClick={(j) => nav(`/jobs/${j.id}`)}
        minWidth="980px"
        emptyText="No jobs yet"
        columns={[
          { key: "job_number", header: "Job ID", className: "font-mono font-medium text-blue-600" },
          { key: "client_name", header: "Client", className: "text-slate-700" },
          { key: "site_location", header: "Site", render: (j) => <span className="text-slate-600">{j.site_location || "—"}</span> },
          { key: "field_name", header: "Field Name", render: (j) => <span className="text-slate-900">{j.field_name || j.job_name || "—"}</span> },
          { key: "start_date", header: "Start Date", hideOnMobile: true, render: (j) => <span className="font-mono text-slate-500">{fmtDate(j.start_date)}</span> },
          { key: "end_date", header: "End Date", hideOnMobile: true, render: (j) => <span className="font-mono text-slate-500">{fmtDate(j.end_date)}</span> },
          { key: "status", header: "Status", render: (j) => <StatusBadge value={j.status} /> },
          { key: "notes", header: "Notes", hideOnMobile: true, render: (j) => <span className="block max-w-[14rem] truncate text-slate-600">{j.notes || "—"}</span> },
          { key: "_actions", header: canManage(user) ? "Actions" : "", align: "right", stop: true, render: (j) => canManage(user) && <span className="whitespace-nowrap"><button onClick={() => openEdit(j)} className="mr-2 text-slate-400 hover:text-blue-600"><Pencil className="inline h-4 w-4" /></button><button onClick={() => del(j)} className="text-slate-400 hover:text-red-600"><Trash2 className="inline h-4 w-4" /></button></span> },
        ]}
      />

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Job" : "Add Job"}</DialogTitle></DialogHeader>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Job ID</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-700">{editing?.job_number || "Generated automatically on save"}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput label="Client" required value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              <option value="">Select client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectInput>
            <TextInput label="Site" value={form.site_location} onChange={(e) => setForm({ ...form, site_location: e.target.value })} />
            <TextInput label="Field Name" required className="sm:col-span-2" placeholder="Enter field name manually" value={form.field_name} onChange={(e) => setForm({ ...form, field_name: e.target.value })} />
            <TextInput label="Start Date" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <TextInput label="End Date" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            <SelectInput label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</SelectInput>
            <TextArea label="Notes" className="sm:col-span-2" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <DialogFooter><Btn variant="outline" onClick={() => setDialog(false)}>Cancel</Btn><Btn onClick={save}>{editing ? "Save" : "Create"}</Btn></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
