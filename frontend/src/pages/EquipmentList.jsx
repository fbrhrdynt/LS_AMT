import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  HardHat,
  Plus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  QrCode,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useAuth, canManage } from "@/context/AuthContext";
import {
  PageHeader,
  Btn,
  EmptyState,
  TextInput,
  SelectInput,
} from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import EquipmentQRDialog from "@/components/EquipmentQRDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const PLACEMENTS = ["Base", "Workshop", "Job", "Transit"];
const STATUSES = [
  "Operational",
  "Under Maintenance",
  "Out of Service",
  "Standby",
];

export default function EquipmentList() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState({
    items: [],
    total: 0,
    page: 1,
  });
  const [q, setQ] = useState("");
  const [placement, setPlacement] = useState(
    sp.get("placement") || ""
  );
  const [status, setStatus] = useState(
    sp.get("status") || ""
  );
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [qrEquipment, setQrEquipment] = useState(null);

  const EMPTY = {
    sap_no: "",
    mfg_no: "",
    name: "",
    category: "",
    manufacturer: "",
    placement: "Base",
    operational_status: "Operational",
  };
  const [form, setForm] = useState(EMPTY);
  const pageSize = 20;

  const reqRef = useRef(0);
  const load = useCallback(async () => {
    const rid = ++reqRef.current;
    const params = new URLSearchParams({
      q,
      placement,
      status,
      page,
      page_size: pageSize,
    });
    const { data } = await api.get(`/equipment?${params}`);
    if (rid === reqRef.current) setData(data);
  }, [q, placement, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialog(true);
  };

  const openEdit = (e) => {
    setEditing(e);
    setForm({
      sap_no: e.sap_no,
      mfg_no: e.mfg_no || "",
      name: e.name || "",
      category: e.category || "",
      manufacturer: e.manufacturer || "",
      placement: e.placement || "Base",
      operational_status:
        e.operational_status || "Operational",
    });
    setDialog(true);
  };

  const save = async () => {
    if (!form.sap_no) {
      toast.error("SAP number is required");
      return;
    }

    try {
      if (editing) {
        await api.put(`/equipment/${editing.id}`, {
          ...form,
          placement_detail: form.placement,
        });
      } else {
        await api.post("/equipment", {
          ...form,
          placement_detail: form.placement,
        });
      }

      toast.success(
        editing ? "Equipment updated" : "Equipment created"
      );
      setDialog(false);
      setForm(EMPTY);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const del = async (e) => {
    if (
      !window.confirm(
        `Delete ${e.sap_no}? This also removes its maintenance, failures and assignment history.`
      )
    ) {
      return;
    }

    try {
      await api.delete(`/equipment/${e.id}`);
      toast.success("Equipment deleted");
      load();
    } catch (err) {
      toast.error(
        formatApiError(err.response?.data?.detail)
      );
    }
  };

  const totalPages = Math.max(
    1,
    Math.ceil(data.total / pageSize)
  );

  return (
    <div>
      <PageHeader
        title="Equipment"
        subtitle={`${data.total} assets in register`}
      >
        {canManage(user) && (
          <Btn
            onClick={openCreate}
            data-testid="add-equipment-btn"
          >
            <Plus className="h-4 w-4" />
            Add Equipment
          </Btn>
        )}
      </PageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <TextInput
          className="sm:col-span-2"
          placeholder="Search SAP, Serial, Name, Category…"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          data-testid="equipment-search"
        />

        <SelectInput
          value={placement}
          onChange={(e) => {
            setPage(1);
            setPlacement(e.target.value);
          }}
          data-testid="filter-placement"
        >
          <option value="">All Placements</option>
          {PLACEMENTS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </SelectInput>

        <SelectInput
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          data-testid="filter-status"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectInput>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Asset / SAP</th>
                <th className="px-4 py-3">Serial / Mfg</th>
                <th className="px-4 py-3">Equipment</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Placement</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {data.items.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => nav(`/equipment/${e.id}`)}
                  data-testid={`equipment-row-${e.id}`}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-mono font-medium text-blue-600">
                    {e.sap_no}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-500">
                    {e.mfg_no || "—"}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-900">
                    {e.name || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {e.category || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge value={e.placement} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      value={e.operational_status}
                    />
                  </td>

                  <td
                    className="whitespace-nowrap px-4 py-3 text-right"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setQrEquipment(e)}
                      className="mr-3 text-slate-400 hover:text-blue-600"
                      title="View / Download QR"
                      aria-label={`QR code for ${e.sap_no}`}
                      data-testid={`qr-equipment-${e.id}`}
                    >
                      <QrCode className="inline h-4 w-4" />
                    </button>

                    {canManage(user) && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(e)}
                          className="mr-3 text-slate-400 hover:text-blue-600"
                          title="Edit"
                          data-testid={`edit-equipment-${e.id}`}
                        >
                          <Pencil className="inline h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => del(e)}
                          className="text-slate-400 hover:text-red-600"
                          title="Delete"
                          data-testid={`delete-equipment-${e.id}`}
                        >
                          <Trash2 className="inline h-4 w-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.items.length === 0 && (
          <EmptyState
            icon={HardHat}
            text="No equipment found"
          />
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          Page {data.page} of {totalPages}
        </span>

        <div className="flex gap-2">
          <Btn
            variant="outline"
            aria-label="Previous page"
            data-testid="page-prev"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Btn>

          <Btn
            variant="outline"
            aria-label="Next page"
            data-testid="page-next"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Btn>
        </div>
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Equipment" : "Add Equipment"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Asset / SAP No."
              required
              value={form.sap_no}
              onChange={(e) =>
                setForm({
                  ...form,
                  sap_no: e.target.value,
                })
              }
              data-testid="eq-form-sap"
            />

            <TextInput
              label="Serial / Mfg No."
              value={form.mfg_no}
              onChange={(e) =>
                setForm({
                  ...form,
                  mfg_no: e.target.value,
                })
              }
            />

            <TextInput
              label="Equipment Name/Type"
              className="sm:col-span-2"
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                })
              }
            />

            <TextInput
              label="Category"
              value={form.category}
              onChange={(e) =>
                setForm({
                  ...form,
                  category: e.target.value,
                })
              }
            />

            <TextInput
              label="Manufacturer"
              value={form.manufacturer}
              onChange={(e) =>
                setForm({
                  ...form,
                  manufacturer: e.target.value,
                })
              }
            />

            <SelectInput
              label="Placement"
              value={form.placement}
              onChange={(e) =>
                setForm({
                  ...form,
                  placement: e.target.value,
                })
              }
            >
              {PLACEMENTS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </SelectInput>

            <SelectInput
              label="Operational Status"
              value={form.operational_status}
              onChange={(e) =>
                setForm({
                  ...form,
                  operational_status: e.target.value,
                })
              }
            >
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </SelectInput>
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
              data-testid="eq-form-save"
            >
              {editing ? "Save" : "Create"}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EquipmentQRDialog
        open={Boolean(qrEquipment)}
        onOpenChange={(next) => {
          if (!next) setQrEquipment(null);
        }}
        equipment={qrEquipment}
        canReset={canManage(user)}
      />
    </div>
  );
}
