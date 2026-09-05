import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import {
  Btn, TextInput, TextArea, SelectInput,
} from "@/components/Bits";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import ItemCombobox from "@/components/ItemCombobox";
import { useCurrency } from "@/context/CurrencyContext";

const MNT_TYPES = [
  "Preventive",
  "Corrective",
  "Breakdown",
  "Inspection",
];

const CATEGORIES = [
  "Pre-Job",
  "Major Repair",
  "Post-Job",
];

const normalizeParts = (rows = []) =>
  rows.map((p) => ({
    item_id: p.item_id || "",
    qty: p.qty ?? 1,
    item_name: p.item_name,
    item_code: p.item_code,
    unit: p.unit,
    supply_source: p.supply_source || "Ex-Stock",
    stock_override: Boolean(p.stock_override),
  }));

// mode: "create" | "edit" | "close"
export default function MaintenanceDialog({
  open,
  onOpenChange,
  equipment,
  mode = "create",
  maintenance,
  onSaved,
}) {
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

    api.get("/clients").then((r) => setClients(r.data)).catch(() => {});
    api.get("/jobs").then((r) => setJobs(r.data)).catch(() => {});
    api.get("/inventory").then((r) => setInventory(r.data)).catch(() => {});

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
      setParts(normalizeParts(maintenance.parts_consumed || []));
      setSupportInput((maintenance.support_technicians || []).join(", "));
    } else if (mode === "edit" && maintenance) {
      setForm({
        maintenance_date: maintenance.maintenance_date || "",
        type_of_maintenance: maintenance.type_of_maintenance || "Corrective",
        maintenance_category:
          maintenance.maintenance_category || "Pre-Job",
        problem_damage: maintenance.problem_damage || "",
        failure_found: maintenance.failure_found || "",
        root_cause: maintenance.root_cause || "",
        action_taken: maintenance.action_taken || "",
        duration_days: maintenance.duration_days || 0,
        lead_technician: maintenance.lead_technician || "",
        checked_by: maintenance.checked_by || "",
        final_condition: maintenance.final_condition || "",
        remark: maintenance.remark || "",
        notes: maintenance.notes || "",
        client_id: maintenance.client_id || "",
        job_id: maintenance.job_id || "",
        maintenance_purpose: maintenance.maintenance_purpose || "",
      });
      setParts(normalizeParts(maintenance.parts_consumed || []));
      setSupportInput((maintenance.support_technicians || []).join(", "));
    } else {
      setForm({
        maintenance_date: new Date().toISOString().slice(0, 10),
        type_of_maintenance: "Corrective",
        maintenance_category: "Pre-Job",
        problem_damage: "",
        failure_found: "",
        root_cause: "",
        action_taken: "",
        duration_days: 0,
        lead_technician: "",
        checked_by: "",
        final_condition: "",
        remark: "",
        notes: "",
        client_id: equipment?.current_client_id || "",
        job_id: equipment?.current_job_id || "",
        maintenance_purpose: "",
      });
      setParts([]);
      setSupportInput("");
    }
  }, [open, mode, maintenance, equipment]);

  const onDateClosedChange = (val) => {
    const start = form.maintenance_date;
    let dur = form.duration_days;

    if (start && val) {
      const diff = Math.round(
        (new Date(val) - new Date(start)) / 86400000
      );
      if (!Number.isNaN(diff)) dur = Math.max(0, diff);
    }

    setForm({
      ...form,
      date_closed: val,
      duration_days: dur,
    });
  };

  const addPart = () =>
    setParts([
      ...parts,
      {
        item_id: "",
        qty: 1,
        supply_source: "Ex-Stock",
        stock_override: false,
      },
    ]);

  const updatePart = (i, patch) =>
    setParts(
      parts.map((p, idx) =>
        idx === i ? { ...p, ...patch } : p
      )
    );

  const removePart = (i) =>
    setParts(parts.filter((_, idx) => idx !== i));

  const hasPricedParts = parts.some(
    (p) => ["Purchase", "Warehouse"].includes(
      p.supply_source || "Ex-Stock"
    )
  );

  const pricedTotalCost = parts.reduce((sum, p) => {
    const source = p.supply_source || "Ex-Stock";
    if (!["Purchase", "Warehouse"].includes(source)) {
      return sum;
    }

    const it = inventory.find((x) => x.id === p.item_id);
    const qty = Number(p.qty || 0);
    return sum + (it ? (it.unit_price || 0) * qty : 0);
  }, 0);

  const partChecks = useMemo(() => {
    return parts.map((p) => {
      const item = inventory.find((x) => x.id === p.item_id);
      const qty = Number(p.qty || 0);
      const source = p.supply_source || "Ex-Stock";
      const stock = Number(item?.stock || 0);
      const usesInventory =
        source === "Ex-Stock";
      const shortage =
        Boolean(item) &&
        usesInventory &&
        qty > stock;

      return {
        item,
        qty,
        source,
        stock,
        usesInventory,
        shortage,
        blocking: shortage,
        invalidQty: Boolean(p.item_id) && qty <= 0,
      };
    });
  }, [parts, inventory]);

  const hasBlockingPart = partChecks.some(
    (x) => x.blocking || x.invalidQty
  );

  const submit = async () => {
    if (hasBlockingPart) {
      toast.error(
        "Resolve the spare-part warning first: choose Purchase/Warehouse or correct the quantity. Ex-Stock cannot make stock negative."
      );
      return;
    }

    setBusy(true);

    const support = supportInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const partPayload = parts
      .filter((p) => p.item_id)
      .map((p) => ({
        item_id: p.item_id,
        qty: Number(p.qty),
        supply_source: p.supply_source || "Ex-Stock",
        stock_override: false,
      }));

    try {
      if (mode === "create") {
        await api.post("/maintenance", {
          equipment_id: equipment.id,
          ...form,
          support_technicians: support,
          parts: partPayload,
        });
        toast.success("Maintenance created");
      } else if (mode === "edit") {
        await api.put(`/maintenance/${maintenance.id}`, {
          equipment_id: equipment.id,
          ...form,
          support_technicians: support,
          parts: partPayload,
        });
        toast.success("Maintenance updated");
      } else {
        await api.post(`/maintenance/${maintenance.id}/close`, {
          ...form,
          support_technicians: support,
          parts: partPayload,
        });
        toast.success("Maintenance closed");
      }

      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const isForm = mode === "create" || mode === "edit";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>
            {mode === "close"
              ? `Close ${maintenance?.mnt_no}`
              : mode === "edit"
                ? `Edit ${maintenance?.mnt_no}`
                : "New Maintenance"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {isForm && (
            <>
              <TextInput
                label="Maintenance Date"
                type="date"
                value={form.maintenance_date || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    maintenance_date: e.target.value,
                  })
                }
                data-testid="mf-date"
              />
              <SelectInput
                label="Type of Maintenance"
                value={form.type_of_maintenance}
                onChange={(e) =>
                  setForm({
                    ...form,
                    type_of_maintenance: e.target.value,
                  })
                }
                data-testid="mf-type"
              >
                {MNT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </SelectInput>

              <SelectInput
                label="Category"
                value={form.maintenance_category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    maintenance_category: e.target.value,
                  })
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </SelectInput>

              <TextInput
                label="Lead Technician"
                value={form.lead_technician}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lead_technician: e.target.value,
                  })
                }
                data-testid="mf-lead"
              />

              <TextArea
                label="Observed Symptoms"
                className="sm:col-span-2"
                rows={2}
                value={form.problem_damage}
                onChange={(e) =>
                  setForm({
                    ...form,
                    problem_damage: e.target.value,
                  })
                }
                data-testid="mf-problem"
              />
            </>
          )}

          <TextArea
            label="Failure Found"
            className="sm:col-span-2"
            rows={2}
            value={form.failure_found || ""}
            onChange={(e) =>
              setForm({
                ...form,
                failure_found: e.target.value,
              })
            }
            data-testid="mf-failure"
          />

          <TextArea
            label="Root Cause"
            rows={2}
            value={form.root_cause || ""}
            onChange={(e) =>
              setForm({
                ...form,
                root_cause: e.target.value,
              })
            }
            data-testid="mf-rootcause"
          />

          <TextArea
            label="Action Taken"
            rows={2}
            value={form.action_taken || ""}
            onChange={(e) =>
              setForm({
                ...form,
                action_taken: e.target.value,
              })
            }
            data-testid="mf-action"
          />

          <TextInput
            label="Support Technicians (comma separated)"
            className="sm:col-span-2"
            value={supportInput}
            onChange={(e) => setSupportInput(e.target.value)}
            data-testid="mf-support"
          />

          {isForm && (
            <>
              <SelectInput
                label="Client (optional)"
                value={form.client_id || ""}
                onChange={(e) => {
                  const nextClient = e.target.value;
                  const selectedJob = jobs.find((j) => j.id === form.job_id);
                  const keepJob =
                    !selectedJob || selectedJob.client_id === nextClient;
                  setForm({
                    ...form,
                    client_id: nextClient,
                    job_id: keepJob ? form.job_id : "",
                  });
                }}
                data-testid="mf-client"
              >
                <option value="">— none —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectInput>

              <TextInput
                label="Maintenance Purpose"
                className="sm:col-span-2"
                value={form.maintenance_purpose || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    maintenance_purpose: e.target.value,
                  })
                }
                placeholder="Enter maintenance purpose manually"
                data-testid="mf-purpose"
              />
            </>
          )}

          {mode === "close" && (
            <>
              <TextInput
                label="Date Closed"
                type="date"
                min={form.maintenance_date || undefined}
                value={form.date_closed || ""}
                onChange={(e) =>
                  onDateClosedChange(e.target.value)
                }
                data-testid="cf-date"
              />

              <TextInput
                label="Duration (days) — auto"
                type="number"
                value={form.duration_days ?? 0}
                onChange={(e) =>
                  setForm({
                    ...form,
                    duration_days:
                      parseInt(e.target.value, 10) || 0,
                  })
                }
                data-testid="cf-duration"
              />

              <TextInput
                label="Final Condition"
                value={form.final_condition || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    final_condition: e.target.value,
                  })
                }
                data-testid="cf-condition"
              />

              <TextInput
                label="Checked By"
                value={form.checked_by || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    checked_by: e.target.value,
                  })
                }
              />

              <TextInput
                label="Remark"
                className="sm:col-span-2"
                value={form.remark || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    remark: e.target.value,
                  })
                }
              />
            </>
          )}
        </div>

        <div className="mt-2 min-w-0 rounded-md border border-slate-200 p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Spare Parts & Materials
                {mode === "close" && " — processed on close"}
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-slate-400">
                Ex-Stock deducts inventory without displaying a value and
                cannot make stock negative. Purchase records direct use without
                reducing stock and displays its value. Warehouse also
                records direct use without reducing stock and displays its value.
              </span>
            </div>

            <Btn
              variant="outline"
              onClick={addPart}
              className="shrink-0 py-1 text-xs"
              data-testid="add-part"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Btn>
          </div>

          <div className="space-y-3">
            {parts.map((p, i) => {
              const check = partChecks[i];
              const item = check?.item;
              const showsCost =
                ["Purchase", "Warehouse"].includes(check?.source);
              const lineCost =
                item && showsCost
                  ? (item.unit_price || 0) * (Number(p.qty) || 0)
                  : 0;
              const projected =
                item && check?.usesInventory
                  ? check.stock - check.qty
                  : null;

              return (
                <div
                  key={i}
                  className="min-w-0 rounded-md border border-slate-100 bg-slate-50/60 p-2"
                  data-testid={`part-line-${i}`}
                >
                  <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-start">
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <ItemCombobox
                        items={inventory}
                        value={p.item_id}
                        onChange={(id) =>
                          updatePart(i, { item_id: id })
                        }
                        testId={`part-select-${i}`}
                      />

                      {item && (
                        <div className="mt-1 min-w-0 text-[11px] leading-4">
                          {["Purchase", "Warehouse"].includes(check.source) ? (
                            <span className="text-blue-600">
                              {check.source}/direct-use — inventory remains at{" "}
                              <b>
                                {check.stock} {item.unit}
                              </b>.
                            </span>
                          ) : check.shortage ? (
                            <span className="flex items-start gap-1 text-red-600">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>
                                Insufficient stock: have{" "}
                                <b>
                                  {check.stock} {item.unit}
                                </b>
                                , need{" "}
                                <b>
                                  {check.qty} {item.unit}
                                </b>
                                . Ex-Stock cannot create a negative stock
                                balance. Choose Purchase/Warehouse or correct
                                the quantity.
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-500">
                              Available stock:{" "}
                              <b>
                                {check.stock} {item.unit}
                              </b>
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid shrink-0 grid-cols-[80px_minmax(0,1fr)_36px] gap-2 md:grid-cols-[80px_130px_36px]">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Qty
                        </label>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={p.qty}
                          onChange={(e) =>
                            updatePart(i, {
                              qty: e.target.value,
                            })
                          }
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm font-mono"
                          data-testid={`part-qty-${i}`}
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Source
                        </label>
                        <select
                          value={p.supply_source || "Ex-Stock"}
                          onChange={(e) =>
                            updatePart(i, {
                              supply_source: e.target.value,
                              stock_override: false,
                            })
                          }
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                          data-testid={`part-source-${i}`}
                        >
                          <option value="Ex-Stock">Ex-Stock</option>
                          <option value="Purchase">Purchase</option>
                          <option value="Warehouse">Warehouse</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => removePart(i)}
                        title="Remove"
                        className="col-start-3 row-start-1 mt-[17px] flex h-[34px] w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 md:col-start-3 md:row-start-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {item && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
                      <span className="min-w-0 truncate text-slate-400">
                        {item.item_code} · {item.item_name}
                      </span>

                      {showsCost && (
                        <span className="shrink-0 font-mono font-semibold text-blue-700">
                          {check.source} value: {format(lineCost)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {parts.length === 0 && (
              <p className="text-xs text-slate-400">
                No parts added.
              </p>
            )}
          </div>

          {hasPricedParts && (
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2 text-sm">
              <span className="text-slate-500">
                Estimated recorded value
              </span>
              <span
                className="font-mono font-bold text-slate-900"
                data-testid="mf-total-cost"
              >
                {format(pricedTotalCost)}
              </span>
            </div>
          )}
        </div>

        {hasBlockingPart && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              One or more Ex-Stock items exceed the available inventory.
              Change the source to <b>Purchase</b> / <b>Warehouse</b>, or
              correct the quantity before closing.
            </span>
          </div>
        )}

        <DialogFooter>
          <Btn
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Btn>
          <Btn
            onClick={submit}
            disabled={busy || hasBlockingPart}
            data-testid="mf-submit"
          >
            {busy && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {mode === "close"
              ? "Close Maintenance"
              : mode === "edit"
                ? "Save Changes"
                : "Create"}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
