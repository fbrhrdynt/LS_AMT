import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Package, Plus, Pencil, ArrowUpDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth, canManage } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import { PageHeader, Btn, TextInput, SelectInput } from "@/components/Bits";
import DataTable from "@/components/DataTable";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const TYPES = ["Spare Part", "Consumable"];
const empty = { item_code: "", item_name: "", type: "Spare Part", part_number: "", unit: "EA", stock: 0, min_stock: 0, storage_location: "", unit_price: 0 };

export default function Inventory() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const [sp] = useSearchParams();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [low, setLow] = useState(sp.get("low") === "1");
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [adjust, setAdjust] = useState(null);
  const [adjQty, setAdjQty] = useState("");
  const [adjNote, setAdjNote] = useState("");

  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const rid = ++reqRef.current;
    try {
      const params = new URLSearchParams({ q, type });
      if (low) params.set("low", "true");
      const { data } = await api.get(`/inventory?${params}`);
      if (rid === reqRef.current) setItems(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed to load inventory");
    }
  }, [q, type, low]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(empty); setDialog(true); };
  const openEdit = (it) => { setEditing(it); setForm(it); setDialog(true); };

  const save = async () => {
    try {
      if (editing) await api.put(`/inventory/${editing.id}`, form);
      else await api.post("/inventory", form);
      toast.success("Saved"); setDialog(false); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const doAdjust = async () => {
    try {
      await api.post(`/inventory/${adjust.id}/adjust`, { qty: parseFloat(adjQty), note: adjNote });
      toast.success("Stock adjusted"); setAdjust(null); setAdjQty(""); setAdjNote(""); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const del = async (it) => {
    if (!window.confirm(`Delete item ${it.item_code}?`)) return;
    try { await api.delete(`/inventory/${it.id}`); toast.success("Item deleted"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div>
      <PageHeader title="Parts & Consumables" subtitle={`${items.length} inventory items`}>
        {canManage(user) && <Btn onClick={openCreate} data-testid="add-item-btn"><Plus className="h-4 w-4" /> Add Item</Btn>}
      </PageHeader>

      <DataTable
        data={items}
        searchKeys={["item_code", "item_name", "part_number", "storage_location"]}
        searchPlaceholder="Search code, name, part number…"
        testIdPrefix="inventory"
        rowTestId={(it) => `item-row-${it.id}`}
        minWidth="900px"
        emptyText="No inventory items"
        toolbar={
          <>
            <SelectInput value={type} onChange={(e) => setType(e.target.value)} className="min-w-[9rem]">
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </SelectInput>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} data-testid="low-stock-toggle" /> Low stock only
            </label>
          </>
        }
        columns={[
          { key: "item_code", header: "Code", className: "font-mono font-medium text-slate-900" },
          { key: "item_name", header: "Name", className: "text-slate-900" },
          { key: "type", header: "Type", render: (it) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${it.type === "Spare Part" ? "bg-blue-100 text-blue-800" : "bg-teal-100 text-teal-800"}`}>{it.type}</span> },
          { key: "part_number", header: "Part No.", hideOnMobile: true, render: (it) => <span className="font-mono text-slate-500">{it.part_number || "—"}</span> },
          { key: "stock", header: "Stock", align: "right", render: (it) => <span className={`font-mono font-bold ${it.stock <= it.min_stock ? "text-red-600" : "text-slate-900"}`}>{it.stock} {it.unit}</span> },
          { key: "min_stock", header: "Min", align: "right", hideOnMobile: true, render: (it) => <span className="font-mono text-slate-500">{it.min_stock}</span> },
          { key: "unit_price", header: "Unit Price", align: "right", render: (it) => <span className="font-mono text-slate-700">{it.unit_price ? format(it.unit_price) : "—"}</span> },
          { key: "storage_location", header: "Location", hideOnMobile: true, render: (it) => <span className="text-slate-600">{it.storage_location || "—"}</span> },
          { key: "_actions", header: "", align: "right", stop: true, render: (it) => canManage(user) && (
            <span className="whitespace-nowrap">
              <button onClick={() => setAdjust(it)} title="Adjust stock" className="mr-2 text-slate-400 hover:text-blue-600" data-testid={`adjust-${it.id}`}><ArrowUpDown className="h-4 w-4 inline" /></button>
              <button onClick={() => openEdit(it)} title="Edit" className="mr-2 text-slate-400 hover:text-blue-600" data-testid={`edit-item-${it.id}`}><Pencil className="h-4 w-4 inline" /></button>
              <button onClick={() => del(it)} title="Delete" className="text-slate-400 hover:text-red-600" data-testid={`delete-item-${it.id}`}><Trash2 className="h-4 w-4 inline" /></button>
            </span>
          ) },
        ]}
      />

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Item" : "Add Item"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Item Code" required value={form.item_code} onChange={(e) => setForm({ ...form, item_code: e.target.value })} data-testid="item-code" />
            <SelectInput label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </SelectInput>
            <TextInput label="Item Name" className="sm:col-span-2" value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} data-testid="item-name" />
            <TextInput label="Part Number" value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} />
            <TextInput label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            <TextInput label="Stock" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: parseFloat(e.target.value) || 0 })} data-testid="item-stock" />
            <TextInput label="Minimum Stock" type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: parseFloat(e.target.value) || 0 })} />
            <TextInput label="Unit Price (estimate)" type="number" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: parseFloat(e.target.value) || 0 })} data-testid="item-price" />
            <TextInput label="Storage Location" className="sm:col-span-2" value={form.storage_location} onChange={(e) => setForm({ ...form, storage_location: e.target.value })} />
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setDialog(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="save-item">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjust} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adjust Stock — {adjust?.item_name}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Current stock: <b className="font-mono">{adjust?.stock} {adjust?.unit}</b>. Enter a positive number to add, negative to remove.</p>
          <TextInput label="Quantity (+/-)" type="number" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} data-testid="adjust-qty" />
          <TextInput label="Note" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
          <DialogFooter>
            <Btn variant="outline" onClick={() => setAdjust(null)}>Cancel</Btn>
            <Btn onClick={doAdjust} data-testid="confirm-adjust">Apply</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
