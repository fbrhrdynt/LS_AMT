import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Btn, TextInput, TextArea, SelectInput } from "@/components/Bits";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import ItemCombobox from "@/components/ItemCombobox";
import { useCurrency } from "@/context/CurrencyContext";

const MNT_TYPES = ["Preventive", "Corrective", "Major Repair", "Breakdown Maintenance", "Condition Based Maintenance", "Inspection", "Overhaul"];
const CATEGORIES = ["Condition Based Maintenance", "Breakdown Maintenance", "Planned", "Unplanned"];

// mode: "create" | "close"
export default function MaintenanceDialog({ open, onOpenChange, equipment, mode = "create", maintenance, onSaved }) {
  const { format } = useCurrency();
  const [clients, setClients] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});
  const [parts, setParts] = useState([]);
  const [supportInput, setSupportInput] = useState("");

  useEffect(() => {
    if (!open) return;
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/jobs").then((r) => setJobs(r.data));
    api.get("/inventory").then((r) => setInventory(r.data));
    if (mode === "close" && maintenance) {
      setForm({
        maintenance_date: maintenance.maintenance_date || "",
        date_closed: new Date().toISOString().slice(0, 10),
        duration_days: maintenance.duration_days || 0,
        failure_found: maintenance.failure_found || "",
        root_cause: maintenance.root_cause || "",
        action_taken: maintenance.action_taken || "",
        final_condition: maintenance.final_condition || "Good to go",
        checked_by: maintenance.checked_by || "",
        remark: maintenance.remark || "",
      });
      setParts((maintenance.parts_consumed || []).map((p) => ({ item_id: p.item_id, qty: p.qty, item_name: p.item_name, unit: p.unit, item_code: p.item_code })));
      setSupportInput((maintenance.support_technicians || []).join(", "));
    } else if (mode === "edit" && maintenance) {
      setForm({
        maintenance_date: maintenance.maintenance_date || "",
        type_of_maintenance: maintenance.type_of_maintenance || "Corrective",
        maintenance_category: maintenance.maintenance_category || "Breakdown Maintenance",
        problem_damage: maintenance.problem_damage || "", failure_found: maintenance.failure_found || "",
        root_cause: maintenance.root_cause || "", action_taken: maintenance.action_taken || "",
        duration_days: maintenance.duration_days || 0, lead_technician: maintenance.lead_technician || "",
        checked_by: maintenance.checked_by || "", final_condition: maintenance.final_condition || "",
        remark: maintenance.remark || "", notes: maintenance.notes || "",
        client_id: maintenance.client_id || "", job_id: maintenance.job_id || "",
      });
      setParts((maintenance.parts_consumed || []).map((p) => ({ item_id: p.item_id, qty: p.qty, item_name: p.item_name, unit: p.unit, item_code: p.item_code })));
      setSupportInput((maintenance.support_technicians || []).join(", "));
    } else {
      setForm({
        maintenance_date: new Date().toISOString().slice(0, 10),
        type_of_maintenance: "Corrective", maintenance_category: "Breakdown Maintenance",
        problem_damage: "", failure_found: "", root_cause: "", action_taken: "",
        duration_days: 0, lead_technician: "", checked_by: "", final_condition: "",
        remark: "", notes: "", client_id: equipment?.current_client_id || "", job_id: equipment?.current_job_id || "",
      });
      setParts([]); setSupportInput("");
    }
  }, [open, mode, maintenance, equipment]);

  // Auto-calculate duration (days) from maintenance date -> date closed
  const onDateClosedChange = (val) => {
    const start = form.maintenance_date;
    let dur = form.duration_days;
    if (start && val) {
      const diff = Math.round((new Date(val) - new Date(start)) / 86400000);
      if (!Number.isNaN(diff)) dur = Math.max(0, diff);
    }
    setForm({ ...form, date_closed: val, duration_days: dur });
  };

  const addPart = () => setParts([...parts, { item_id: "", qty: 1 }]);
  const updatePart = (i, patch) => setParts(parts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removePart = (i) => setParts(parts.filter((_, idx) => idx !== i));

  const totalCost = parts.reduce((sum, p) => {
    const it = inventory.find((x) => x.id === p.item_id);
    return sum + (it ? (it.unit_price || 0) * (parseFloat(p.qty) || 0) : 0);
  }, 0);

  const submit = async () => {
    setBusy(true);
    const support = supportInput.split(",").map((s) => s.trim()).filter(Boolean);
    const partPayload = parts.filter((p) => p.item_id).map((p) => ({ item_id: p.item_id, qty: parseFloat(p.qty) || 0 }));
    try {
      if (mode === "create") {
        await api.post("/maintenance", { equipment_id: equipment.id, ...form, support_technicians: support, parts: partPayload });
        toast.success("Maintenance created");
      } else if (mode === "edit") {
        await api.put(`/maintenance/${maintenance.id}`, { equipment_id: equipment.id, ...form, support_technicians: support, parts: partPayload });
        toast.success("Maintenance updated");
      } else {
        await api.post(`/maintenance/${maintenance.id}/close`, { ...form, support_technicians: support, parts: partPayload });
        toast.success("Maintenance closed & stock deducted");
      }
      onOpenChange(false); onSaved?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const isForm = mode === "create" || mode === "edit";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto overflow-x-hidden">
        <DialogHeader><DialogTitle>{mode === "close" ? `Close ${maintenance?.mnt_no}` : mode === "edit" ? `Edit ${maintenance?.mnt_no}` : "New Maintenance"}</DialogTitle></DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {isForm && <>
            <TextInput label="Maintenance Date" type="date" value={form.maintenance_date || ""} onChange={(e) => setForm({ ...form, maintenance_date: e.target.value })} data-testid="mf-date" />
            <SelectInput label="Type of Maintenance" value={form.type_of_maintenance} onChange={(e) => setForm({ ...form, type_of_maintenance: e.target.value })} data-testid="mf-type">
              {MNT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </SelectInput>
            <SelectInput label="Category" value={form.maintenance_category} onChange={(e) => setForm({ ...form, maintenance_category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </SelectInput>
            <TextInput label="Lead Technician" value={form.lead_technician} onChange={(e) => setForm({ ...form, lead_technician: e.target.value })} data-testid="mf-lead" />
            <TextArea label="Problem / Damage" className="sm:col-span-2" rows={2} value={form.problem_damage} onChange={(e) => setForm({ ...form, problem_damage: e.target.value })} data-testid="mf-problem" />
          </>}

          <TextArea label="Failure Found" className="sm:col-span-2" rows={2} value={form.failure_found || ""} onChange={(e) => setForm({ ...form, failure_found: e.target.value })} data-testid="mf-failure" />
          <TextArea label="Root Cause" rows={2} value={form.root_cause || ""} onChange={(e) => setForm({ ...form, root_cause: e.target.value })} data-testid="mf-rootcause" />
          <TextArea label="Action Taken" rows={2} value={form.action_taken || ""} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} data-testid="mf-action" />
          <TextInput label="Support Technicians (comma separated)" className="sm:col-span-2" value={supportInput} onChange={(e) => setSupportInput(e.target.value)} data-testid="mf-support" />

          {isForm && <>
            <SelectInput label="Client (optional)" value={form.client_id || ""} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              <option value="">— none —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectInput>
            <SelectInput label="Job (optional)" value={form.job_id || ""} onChange={(e) => setForm({ ...form, job_id: e.target.value })} data-testid="mf-job">
              <option value="">— none / Base-Workshop —</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.job_name}</option>)}
            </SelectInput>
            <TextArea label="Notes" className="sm:col-span-2" rows={2} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="mf-notes" />
          </>}

          {mode === "close" && <>
            <TextInput label="Date Closed" type="date" min={form.maintenance_date || undefined} value={form.date_closed || ""} onChange={(e) => onDateClosedChange(e.target.value)} data-testid="cf-date" />
            <TextInput label="Duration (days) — auto" type="number" value={form.duration_days ?? 0} onChange={(e) => setForm({ ...form, duration_days: parseInt(e.target.value) || 0 })} data-testid="cf-duration" />
            <TextInput label="Final Condition" value={form.final_condition || ""} onChange={(e) => setForm({ ...form, final_condition: e.target.value })} data-testid="cf-condition" />
            <TextInput label="Checked By" value={form.checked_by || ""} onChange={(e) => setForm({ ...form, checked_by: e.target.value })} />
            <TextInput label="Remark" className="sm:col-span-2" value={form.remark || ""} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </>}
        </div>

        {/* Parts */}
        <div className="mt-2 rounded-md border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Spare Parts & Consumables{mode === "close" && " — deducted on close"}</span>
            <Btn variant="outline" onClick={addPart} className="py-1 text-xs" data-testid="add-part"><Plus className="h-3.5 w-3.5" /> Add</Btn>
          </div>
          <div className="space-y-2">
            {parts.map((p, i) => {
              const item = inventory.find((x) => x.id === p.item_id);
              const lineCost = item ? (item.unit_price || 0) * (parseFloat(p.qty) || 0) : 0;
              return (
                <div key={i} className="flex items-center gap-2" data-testid={`part-line-${i}`}>
                  <div className="flex-1 min-w-0">
                    <ItemCombobox items={inventory} value={p.item_id}
                      onChange={(id) => updatePart(i, { item_id: id })} testId={`part-select-${i}`} />
                  </div>
                  <input type="number" min="0" step="0.5" value={p.qty} onChange={(e) => updatePart(i, { qty: e.target.value })}
                    className="w-16 rounded-md border border-slate-200 px-2 py-1.5 text-sm font-mono" data-testid={`part-qty-${i}`} />
                  <span className="hidden w-8 text-xs text-slate-400 md:inline">{item?.unit || p.unit || ""}</span>
                  <span className="hidden w-24 shrink-0 text-right font-mono text-xs text-slate-600 md:inline">{lineCost ? format(lineCost) : "—"}</span>
                  <button onClick={() => removePart(i)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              );
            })}
            {parts.length === 0 && <p className="text-xs text-slate-400">No parts added.</p>}
          </div>
          {parts.length > 0 && (
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2 text-sm">
              <span className="text-slate-500">Estimated total cost</span>
              <span className="font-mono font-bold text-slate-900" data-testid="mf-total-cost">{format(totalCost)}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Btn variant="outline" onClick={() => onOpenChange(false)}>Cancel</Btn>
          <Btn onClick={submit} disabled={busy} data-testid="mf-submit">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "close" ? "Close Maintenance" : mode === "edit" ? "Save Changes" : "Create"}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
