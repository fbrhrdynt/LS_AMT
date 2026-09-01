import { useEffect, useState } from "react";
import { Building2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth, canManage } from "@/context/AuthContext";
import { PageHeader, Btn, EmptyState, TextInput, TextArea, Panel } from "@/components/Bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const empty = { name: "", code: "", contact: "", notes: "" };

export default function Clients() {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = async () => { const { data } = await api.get("/clients"); setClients(data); };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name) { toast.error("Name is required"); return; }
    try {
      if (editing) await api.put(`/clients/${editing.id}`, form);
      else await api.post("/clients", form);
      toast.success("Saved"); setDialog(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const del = async (c) => {
    if (!window.confirm(`Delete client ${c.name}?`)) return;
    try { await api.delete(`/clients/${c.id}`); toast.success("Client deleted"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Clients" subtitle={`${clients.length} clients`}>
        {canManage(user) && <Btn onClick={() => { setEditing(null); setForm(empty); setDialog(true); }} data-testid="add-client-btn"><Plus className="h-4 w-4" /> Add Client</Btn>}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <Panel key={c.id} className="p-4" data-testid={`client-card-${c.id}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-heading text-lg font-semibold text-slate-900">{c.name}</div>
                {c.code && <div className="font-mono text-xs text-slate-400">{c.code}</div>}
              </div>
              {canManage(user) && (
                <div className="flex items-center gap-2">
                  <button onClick={() => { setEditing(c); setForm(c); setDialog(true); }} className="text-slate-400 hover:text-blue-600" data-testid={`edit-client-${c.id}`}><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => del(c)} className="text-slate-400 hover:text-red-600" data-testid={`delete-client-${c.id}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>
            {c.contact && <div className="mt-2 text-sm text-slate-600">{c.contact}</div>}
            <div className="mt-3 inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">{c.job_count} job(s)</div>
          </Panel>
        ))}
      </div>
      {clients.length === 0 && <EmptyState icon={Building2} text="No clients yet" />}

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Client" : "Add Client"}</DialogTitle></DialogHeader>
          <TextInput label="Client Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="client-name" />
          <TextInput label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextInput label="Contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          <TextArea label="Notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <DialogFooter>
            <Btn variant="outline" onClick={() => setDialog(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="save-client">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
