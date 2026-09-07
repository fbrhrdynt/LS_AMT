import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Package,
  Plus,
  Pencil,
  ArrowUpDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "@/lib/api";
import { useAuth, canManage } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import {
  PageHeader,
  Btn,
  TextInput,
  SelectInput,
} from "@/components/Bits";
import DataTable from "@/components/DataTable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";


const TYPES = ["Spare Part", "Consumable"];

const SORT_OPTIONS = [
  { value: "category_asc", label: "Category A–Z" },
  { value: "category_desc", label: "Category Z–A" },
  { value: "item_code_asc", label: "Item Code A–Z" },
  { value: "item_name_asc", label: "Item Name A–Z" },
];

const empty = {
  item_code: "",
  item_name: "",
  category: "",
  type: "Spare Part",
  part_number: "",
  unit: "EA",
  stock: 0,
  min_stock: 0,
  storage_location: "",
  unit_price: 0,
};


export default function Inventory() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const [sp] = useSearchParams();

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [sortBy, setSortBy] = useState("category_asc");
  const [low, setLow] = useState(sp.get("low") === "1");

  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const [adjust, setAdjust] = useState(null);
  const [adjQty, setAdjQty] = useState("");
  const [adjNote, setAdjNote] = useState("");

  const reqRef = useRef(0);

  const loadCategories = useCallback(async () => {
    try {
      const { data } = await api.get("/inventory-categories");
      setCategories(Array.isArray(data) ? data : []);
    } catch {
      setCategories([]);
    }
  }, []);

  const load = useCallback(async () => {
    const rid = ++reqRef.current;

    try {
      const params = new URLSearchParams({
        type,
        category,
        sort: sortBy,
      });

      if (low) {
        params.set("low", "true");
      }

      const { data } = await api.get(`/inventory?${params}`);

      if (rid === reqRef.current) {
        setItems(data);
      }
    } catch (e) {
      toast.error(
        formatApiError(e.response?.data?.detail) ||
          "Failed to load inventory"
      );
    }
  }, [type, category, sortBy, low]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...empty,
      category: category || "",
    });
    setDialog(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      ...empty,
      ...item,
      category: item.category || "",
    });
    setDialog(true);
  };

  const save = async () => {
    if (!form.item_code?.trim()) {
      toast.error("Item Code is required");
      return;
    }

    if (!form.item_name?.trim()) {
      toast.error("Item Name is required");
      return;
    }

    try {
      const payload = {
        ...form,
        item_code: form.item_code.trim(),
        item_name: form.item_name.trim(),
        category: (form.category || "").trim(),
        part_number: (form.part_number || "").trim(),
        unit: (form.unit || "EA").trim(),
        storage_location: (form.storage_location || "").trim(),
      };

      if (editing) {
        await api.put(`/inventory/${editing.id}`, payload);
      } else {
        await api.post("/inventory", payload);
      }

      toast.success(editing ? "Inventory item updated" : "Inventory item created");
      setDialog(false);
      setEditing(null);
      setForm(empty);
      await Promise.all([load(), loadCategories()]);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const doAdjust = async () => {
    const qty = parseFloat(adjQty);

    if (!Number.isFinite(qty) || qty === 0) {
      toast.error("Enter a non-zero adjustment quantity");
      return;
    }

    try {
      await api.post(`/inventory/${adjust.id}/adjust`, {
        qty,
        note: adjNote,
      });

      toast.success("Stock adjusted");
      setAdjust(null);
      setAdjQty("");
      setAdjNote("");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const del = async (item) => {
    if (!window.confirm(`Delete item ${item.item_code}?`)) {
      return;
    }

    try {
      await api.delete(`/inventory/${item.id}`);
      toast.success("Item deleted");
      await Promise.all([load(), loadCategories()]);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle={`${items.length} inventory items`}
      >
        {canManage(user) && (
          <Btn
            onClick={openCreate}
            data-testid="add-item-btn"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </Btn>
        )}
      </PageHeader>

      <DataTable
        data={items}
        searchKeys={[
          "item_code",
          "item_name",
          "category",
          "part_number",
          "storage_location",
        ]}
        searchPlaceholder="Search code, name, category, part number…"
        testIdPrefix="inventory"
        rowTestId={(item) => `item-row-${item.id}`}
        minWidth="1080px"
        emptyText="No inventory items"
        toolbar={
          <>
            <SelectInput
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="min-w-[12rem]"
              data-testid="inventory-category-filter"
            >
              <option value="">All Categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectInput>

            <SelectInput
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="min-w-[9rem]"
              data-testid="inventory-type-filter"
            >
              <option value="">All Types</option>
              {TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </SelectInput>

            <SelectInput
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="min-w-[11rem]"
              data-testid="inventory-sort"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Sort: {option.label}
                </option>
              ))}
            </SelectInput>

            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={low}
                onChange={(e) => setLow(e.target.checked)}
                data-testid="low-stock-toggle"
              />
              Low stock only
            </label>
          </>
        }
        columns={[
          {
            key: "item_code",
            header: "Code",
            className:
              "font-mono font-medium text-slate-900",
          },
          {
            key: "item_name",
            header: "Name",
            className: "text-slate-900",
          },
          {
            key: "category",
            header: "Category",
            render: (item) => (
              <span className="font-medium text-slate-700">
                {item.category || "Uncategorized"}
              </span>
            ),
          },
          {
            key: "type",
            header: "Type",
            render: (item) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  item.type === "Spare Part"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-teal-100 text-teal-800"
                }`}
              >
                {item.type}
              </span>
            ),
          },
          {
            key: "part_number",
            header: "Part No.",
            hideOnMobile: true,
            render: (item) => (
              <span className="font-mono text-slate-500">
                {item.part_number || "—"}
              </span>
            ),
          },
          {
            key: "stock",
            header: "Stock",
            align: "right",
            render: (item) => (
              <span
                className={`font-mono font-bold ${
                  item.stock <= item.min_stock
                    ? "text-red-600"
                    : "text-slate-900"
                }`}
              >
                {item.stock} {item.unit}
              </span>
            ),
          },
          {
            key: "min_stock",
            header: "Min",
            align: "right",
            hideOnMobile: true,
            render: (item) => (
              <span className="font-mono text-slate-500">
                {item.min_stock}
              </span>
            ),
          },
          {
            key: "unit_price",
            header: "Unit Price",
            align: "right",
            render: (item) => (
              <span className="font-mono text-slate-700">
                {item.unit_price
                  ? format(item.unit_price)
                  : "—"}
              </span>
            ),
          },
          {
            key: "storage_location",
            header: "Location",
            hideOnMobile: true,
            render: (item) => (
              <span className="text-slate-600">
                {item.storage_location || "—"}
              </span>
            ),
          },
          {
            key: "_actions",
            header: "",
            align: "right",
            stop: true,
            render: (item) =>
              canManage(user) && (
                <span className="whitespace-nowrap">
                  <button
                    onClick={() => setAdjust(item)}
                    title="Adjust stock"
                    className="mr-2 text-slate-400 hover:text-blue-600"
                    data-testid={`adjust-${item.id}`}
                  >
                    <ArrowUpDown className="inline h-4 w-4" />
                  </button>

                  <button
                    onClick={() => openEdit(item)}
                    title="Edit"
                    className="mr-2 text-slate-400 hover:text-blue-600"
                    data-testid={`edit-item-${item.id}`}
                  >
                    <Pencil className="inline h-4 w-4" />
                  </button>

                  <button
                    onClick={() => del(item)}
                    title="Delete"
                    className="text-slate-400 hover:text-red-600"
                    data-testid={`delete-item-${item.id}`}
                  >
                    <Trash2 className="inline h-4 w-4" />
                  </button>
                </span>
              ),
          },
        ]}
      />

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Item" : "Add Item"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Item Code"
              required
              value={form.item_code}
              onChange={(e) =>
                setForm({
                  ...form,
                  item_code: e.target.value,
                })
              }
              data-testid="item-code"
            />

            <SelectInput
              label="Type"
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value,
                })
              }
            >
              {TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </SelectInput>

            <TextInput
              label="Item Name"
              className="sm:col-span-2"
              value={form.item_name}
              onChange={(e) =>
                setForm({
                  ...form,
                  item_name: e.target.value,
                })
              }
              data-testid="item-name"
            />

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Category
              </label>

              <input
                list="inventory-category-options"
                value={form.category || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category: e.target.value,
                  })
                }
                placeholder={'Example: 14" DECANTER'}
                data-testid="item-category"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />

              <datalist id="inventory-category-options">
                {categories.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>

              <p className="mt-1 text-[11px] leading-4 text-slate-400">
                Select an existing category or type a new category.
                New categories become available after the item is saved.
              </p>
            </div>

            <TextInput
              label="Part Number"
              value={form.part_number}
              onChange={(e) =>
                setForm({
                  ...form,
                  part_number: e.target.value,
                })
              }
            />

            <TextInput
              label="Unit"
              value={form.unit}
              onChange={(e) =>
                setForm({
                  ...form,
                  unit: e.target.value,
                })
              }
            />

            <TextInput
              label="Stock"
              type="number"
              value={form.stock}
              onChange={(e) =>
                setForm({
                  ...form,
                  stock:
                    parseFloat(e.target.value) || 0,
                })
              }
              data-testid="item-stock"
            />

            <TextInput
              label="Minimum Stock"
              type="number"
              value={form.min_stock}
              onChange={(e) =>
                setForm({
                  ...form,
                  min_stock:
                    parseFloat(e.target.value) || 0,
                })
              }
            />

            <TextInput
              label="Unit Price (estimate)"
              type="number"
              value={form.unit_price}
              onChange={(e) =>
                setForm({
                  ...form,
                  unit_price:
                    parseFloat(e.target.value) || 0,
                })
              }
              data-testid="item-price"
            />

            <TextInput
              label="Storage Location"
              className="sm:col-span-2"
              value={form.storage_location}
              onChange={(e) =>
                setForm({
                  ...form,
                  storage_location:
                    e.target.value,
                })
              }
            />
          </div>

          <DialogFooter>
            <Btn
              variant="outline"
              onClick={() => setDialog(false)}
            >
              Cancel
            </Btn>

            <Btn
              onClick={save}
              data-testid="save-item"
            >
              Save
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(adjust)}
        onOpenChange={(open) => {
          if (!open) {
            setAdjust(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Adjust Stock — {adjust?.item_name}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-slate-500">
            Current stock:{" "}
            <b className="font-mono">
              {adjust?.stock} {adjust?.unit}
            </b>
            . Enter a positive number to add,
            negative to remove.
          </p>

          {adjust?.category && (
            <p className="text-xs text-slate-400">
              Category:{" "}
              <span className="font-medium text-slate-600">
                {adjust.category}
              </span>
            </p>
          )}

          <TextInput
            label="Quantity (+/-)"
            type="number"
            value={adjQty}
            onChange={(e) =>
              setAdjQty(e.target.value)
            }
            data-testid="adjust-qty"
          />

          <TextInput
            label="Note"
            value={adjNote}
            onChange={(e) =>
              setAdjNote(e.target.value)
            }
          />

          <DialogFooter>
            <Btn
              variant="outline"
              onClick={() => setAdjust(null)}
            >
              Cancel
            </Btn>

            <Btn
              onClick={doAdjust}
              data-testid="confirm-adjust"
            >
              Apply
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
