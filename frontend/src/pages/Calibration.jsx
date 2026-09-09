import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Unlink,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  API,
  api,
  formatApiError,
} from "@/lib/api";
import {
  useAuth,
  canEdit,
  canManage,
} from "@/context/AuthContext";
import {
  Btn,
  PageHeader,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/Bits";
import DataTable from "@/components/DataTable";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";


const DEFAULT_CATEGORIES = [
  "Pressure Gauge",
  "PRV",
  "Dial Indicator",
  "IR Thermometer",
  "Vibration Meter",
  "Torque Wrench",
  "Ultrasonic Thickness Gauge",
  "Heat Stress Meter",
  "Induction Heater",
];

const EMPTY = {
  tool_id: "",
  tool_name: "",
  category: "",
  manufacturer: "",
  model: "",
  range_spec: "",
  calibration_date: "",
  frequency_value: 52,
  frequency_unit: "week",
  cert_number: "",
  calibrated_by: "",
  comments: "",
};


function addMonths(dateValue, months) {
  const value = new Date(
    `${dateValue}T00:00:00`
  );

  if (Number.isNaN(value.getTime())) {
    return "";
  }

  const day = value.getDate();
  value.setDate(1);
  value.setMonth(
    value.getMonth() + Number(months || 0)
  );

  const lastDay = new Date(
    value.getFullYear(),
    value.getMonth() + 1,
    0
  ).getDate();

  value.setDate(
    Math.min(day, lastDay)
  );

  return value
    .toISOString()
    .slice(0, 10);
}


function expiryDateFor(form) {
  if (!form.calibration_date) {
    return "";
  }

  const frequency = Number(
    form.frequency_value || 0
  );

  if (!frequency) {
    return "";
  }

  if (form.frequency_unit === "month") {
    return addMonths(
      form.calibration_date,
      frequency
    );
  }

  const value = new Date(
    `${form.calibration_date}T00:00:00`
  );

  value.setDate(
    value.getDate() +
      frequency * 7
  );

  return value
    .toISOString()
    .slice(0, 10);
}


function expiryInfo(expiredDate) {
  if (!expiredDate) {
    return {
      status: "No Expiry",
      text: "No expiry date",
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const end = new Date(
    `${expiredDate}T00:00:00`
  );

  const days = Math.round(
    (end - today) / 86400000
  );

  if (days < 0) {
    return {
      status: "Expired",
      text: `Expired ${Math.abs(days)} day${
        Math.abs(days) === 1 ? "" : "s"
      } ago`,
    };
  }

  if (days === 0) {
    return {
      status: "Due Soon",
      text: "Expires today",
    };
  }

  return {
    status:
      days <= 30
        ? "Due Soon"
        : "Valid",
    text: `Expires in ${days} day${
      days === 1 ? "" : "s"
    }`,
  };
}


function StatusPill({ value }) {
  const styles = {
    Valid:
      "bg-emerald-50 text-emerald-700",
    "Due Soon":
      "bg-amber-50 text-amber-700",
    Expired:
      "bg-red-50 text-red-700",
    "No Expiry":
      "bg-slate-100 text-slate-600",
  };

  return (
    <span
      className={[
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
        styles[value] ||
          styles["No Expiry"],
      ].join(" ")}
    >
      {value || "No Expiry"}
    </span>
  );
}


function CategoryInput({
  value,
  onChange,
  options,
}) {
  const [open, setOpen] =
    useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const close = (event) => {
      if (
        boxRef.current &&
        !boxRef.current.contains(
          event.target
        )
      ) {
        setOpen(false);
      }
    };

    document.addEventListener(
      "mousedown",
      close
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        close
      );
  }, []);

  const filtered = useMemo(() => {
    const search = String(
      value || ""
    )
      .trim()
      .toLowerCase();

    if (!search) {
      return options;
    }

    return options.filter((item) =>
      item
        .toLowerCase()
        .includes(search)
    );
  }, [options, value]);

  return (
    <div
      ref={boxRef}
      className="relative"
    >
      <label className="mb-1 block text-xs font-medium text-slate-600">
        Category
      </label>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

        <input
          value={value || ""}
          onFocus={() =>
            setOpen(true)
          }
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          placeholder="Search or type a new category…"
          className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="calibration-category"
        />
      </div>

      {open &&
        filtered.length > 0 && (
          <div
            className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
            onWheel={(event) =>
              event.stopPropagation()
            }
          >
            {filtered.map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  onMouseDown={(
                    event
                  ) =>
                    event.preventDefault()
                  }
                  onClick={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {item}
                </button>
              )
            )}
          </div>
        )}

      <div className="mt-1 text-[11px] leading-4 text-slate-400">
        Select an existing category or
        type a new one. New categories
        become searchable after saving.
      </div>
    </div>
  );
}


export default function Calibration() {
  const { user } = useAuth();

  const [tools, setTools] =
    useState([]);
  const [categories, setCategories] =
    useState([]);
  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState("");
  const [
    statusFilter,
    setStatusFilter,
  ] = useState("");

  const [dialog, setDialog] =
    useState(false);
  const [editing, setEditing] =
    useState(null);
  const [form, setForm] =
    useState(EMPTY);
  const [
    certificateFile,
    setCertificateFile,
  ] = useState(null);
  const [saving, setSaving] =
    useState(false);

  const [
    assignTarget,
    setAssignTarget,
  ] = useState(null);
  const [
    assignSearch,
    setAssignSearch,
  ] = useState("");
  const [equipment, setEquipment] =
    useState([]);
  const [
    assignLoading,
    setAssignLoading,
  ] = useState(false);

  const mergedCategories = useMemo(
    () =>
      Array.from(
        new Set([
          ...DEFAULT_CATEGORIES,
          ...categories,
        ])
      ).sort((a, b) =>
        a.localeCompare(b)
      ),
    [categories]
  );

  const load = async () => {
    try {
      const params =
        new URLSearchParams();

      if (categoryFilter) {
        params.set(
          "category",
          categoryFilter
        );
      }

      if (statusFilter) {
        params.set(
          "status",
          statusFilter
        );
      }

      const { data } =
        await api.get(
          `/calibration-tools?${params}`
        );

      setTools(
        Array.isArray(data)
          ? data
          : []
      );
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        ) ||
          "Failed to load calibration tools"
      );
    }
  };

  const loadCategories =
    async () => {
      try {
        const { data } =
          await api.get(
            "/calibration-categories"
          );

        setCategories(
          Array.isArray(data)
            ? data
            : []
        );
      } catch {
        setCategories([]);
      }
    };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categoryFilter,
    statusFilter,
  ]);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (!assignTarget) {
      return;
    }

    let cancelled = false;

    const timer = setTimeout(
      async () => {
        setAssignLoading(true);

        try {
          const params =
            new URLSearchParams({
              page_size: "50",
            });

          if (
            assignSearch.trim()
          ) {
            params.set(
              "q",
              assignSearch.trim()
            );
          }

          const { data } =
            await api.get(
              `/equipment?${params}`
            );

          if (!cancelled) {
            setEquipment(
              data.items || []
            );
          }
        } catch {
          if (!cancelled) {
            setEquipment([]);
          }
        } finally {
          if (!cancelled) {
            setAssignLoading(
              false
            );
          }
        }
      },
      220
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    assignTarget,
    assignSearch,
  ]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY,
    });
    setCertificateFile(null);
    setDialog(true);
  };

  const openEdit = (tool) => {
    setEditing(tool);
    setForm({
      ...EMPTY,
      ...tool,
    });
    setCertificateFile(null);
    setDialog(true);
  };

  const expiredDate =
    expiryDateFor(form);
  const previewExpiry =
    expiryInfo(expiredDate);

  const save = async () => {
    if (!form.tool_id?.trim()) {
      toast.error(
        "Tool ID / Serial No. is required"
      );
      return;
    }

    if (!form.tool_name?.trim()) {
      toast.error(
        "Tool Name / Description is required"
      );
      return;
    }

    if (!form.category?.trim()) {
      toast.error(
        "Calibration Category is required"
      );
      return;
    }

    setSaving(true);

    try {
      const payload = {
        tool_id:
          form.tool_id.trim(),
        tool_name:
          form.tool_name.trim(),
        category:
          form.category.trim(),
        manufacturer:
          (
            form.manufacturer ||
            ""
          ).trim(),
        model:
          (form.model || "").trim(),
        range_spec:
          (
            form.range_spec ||
            ""
          ).trim(),
        calibration_date:
          form.calibration_date ||
          "",
        frequency_value:
          Number(
            form.frequency_value ||
              1
          ),
        frequency_unit:
          form.frequency_unit ||
          "week",
        cert_number:
          (
            form.cert_number ||
            ""
          ).trim(),
        calibrated_by:
          (
            form.calibrated_by ||
            ""
          ).trim(),
        comments:
          (
            form.comments ||
            ""
          ).trim(),
      };

      let saved;

      if (editing) {
        const response =
          await api.put(
            `/calibration-tools/${editing.id}`,
            payload
          );
        saved = response.data;
      } else {
        const response =
          await api.post(
            "/calibration-tools",
            payload
          );
        saved = response.data;
      }

      if (certificateFile) {
        const fd =
          new FormData();
        fd.append(
          "file",
          certificateFile
        );

        await api.post(
          `/calibration-tools/${saved.id}/certificate`,
          fd
        );
      }

      toast.success(
        editing
          ? "Calibration tool updated"
          : "Calibration tool created"
      );

      setDialog(false);
      setEditing(null);
      setCertificateFile(null);

      await Promise.all([
        load(),
        loadCategories(),
      ]);
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const assign = async (
    sapNo = ""
  ) => {
    if (!assignTarget) {
      return;
    }

    try {
      await api.post(
        `/calibration-tools/${assignTarget.id}/assign`,
        {
          sap_no: sapNo,
        }
      );

      toast.success(
        sapNo
          ? `Assigned to SAP ${sapNo}`
          : "Calibration tool unassigned"
      );

      setAssignTarget(null);
      setAssignSearch("");
      setEquipment([]);
      await load();
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        )
      );
    }
  };

  const archive = async (
    tool
  ) => {
    const ok = window.confirm(
      `Archive calibration tool ${tool.tool_id}? Certificate history will be retained.`
    );

    if (!ok) {
      return;
    }

    try {
      await api.delete(
        `/calibration-tools/${tool.id}`
      );

      toast.success(
        "Calibration tool archived"
      );
      await load();
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        )
      );
    }
  };

  return (
    <div>
      <PageHeader
        title="Equipment Calibration"
        subtitle="Calibration tools, certificates, expiry tracking, and equipment assignment"
      >
        {canEdit(user) && (
          <Btn
            onClick={openCreate}
            data-testid="add-calibration-tool"
          >
            <Plus className="h-4 w-4" />
            Add Calibration Tool
          </Btn>
        )}
      </PageHeader>

      <DataTable
        data={tools}
        searchKeys={[
          "tool_id",
          "tool_name",
          "category",
          "equipment_sap_no",
          "equipment_name",
          "cert_number",
          "calibrated_by",
        ]}
        searchPlaceholder="Search tool, category, SAP, certificate…"
        testIdPrefix="calibration"
        pageSize={20}
        minWidth="1450px"
        maxHeight="62vh"
        emptyText="No calibration tools"
        toolbar={
          <>
            <SelectInput
              value={
                categoryFilter
              }
              onChange={(event) =>
                setCategoryFilter(
                  event.target.value
                )
              }
              className="min-w-[12rem]"
            >
              <option value="">
                All Categories
              </option>
              {mergedCategories.map(
                (category) => (
                  <option
                    key={category}
                    value={category}
                  >
                    {category}
                  </option>
                )
              )}
            </SelectInput>

            <SelectInput
              value={
                statusFilter
              }
              onChange={(event) =>
                setStatusFilter(
                  event.target.value
                )
              }
              className="min-w-[10rem]"
            >
              <option value="">
                All Statuses
              </option>
              <option>
                Valid
              </option>
              <option>
                Due Soon
              </option>
              <option>
                Expired
              </option>
              <option>
                No Expiry
              </option>
            </SelectInput>
          </>
        }
        columns={[
          {
            key: "tool_id",
            header:
              "Tool ID / Serial",
            render: (tool) => (
              <span className="font-mono font-semibold text-slate-900">
                {tool.tool_id || "—"}
              </span>
            ),
          },
          {
            key: "tool_name",
            header: "Tool",
            render: (tool) => (
              <span className="block max-w-[15rem] truncate text-slate-900">
                {
                  tool.tool_name
                }
              </span>
            ),
          },
          {
            key: "category",
            header: "Category",
            render: (tool) => (
              <span className="font-medium text-slate-700">
                {
                  tool.category
                }
              </span>
            ),
          },
          {
            key:
              "equipment_sap_no",
            header:
              "Assigned SAP",
            render: (tool) => (
              <div>
                <div className="font-mono font-semibold text-blue-600">
                  {tool.equipment_sap_no ||
                    "—"}
                </div>
                {tool.equipment_name && (
                  <div className="max-w-[12rem] truncate text-xs text-slate-400">
                    {
                      tool.equipment_name
                    }
                  </div>
                )}
              </div>
            ),
          },
          {
            key:
              "calibration_date",
            header:
              "Calibration Date",
            className:
              "font-mono text-slate-600",
          },
          {
            key:
              "frequency_value",
            header: "Frequency",
            render: (tool) => (
              <span className="whitespace-nowrap text-slate-600">
                {
                  tool.frequency_value
                }{" "}
                {tool.frequency_unit ===
                "month"
                  ? "month(s)"
                  : "week(s)"}
              </span>
            ),
          },
          {
            key:
              "expired_date",
            header:
              "Expired Date",
            className:
              "font-mono text-slate-600",
          },
          {
            key: "status",
            header: "Status",
            render: (tool) => (
              <StatusPill
                value={
                  tool.status
                }
              />
            ),
          },
          {
            key:
              "expiry_text",
            header: "Expiry",
            render: (tool) => (
              <span
                className={
                  tool.status ===
                  "Expired"
                    ? "font-medium text-red-600"
                    : tool.status ===
                        "Due Soon"
                      ? "font-medium text-amber-700"
                      : "text-slate-600"
                }
              >
                {
                  tool.expiry_text
                }
              </span>
            ),
          },
          {
            key:
              "cert_number",
            header: "Cert No.",
            render: (tool) => (
              <span className="font-mono text-slate-600">
                {tool.cert_number ||
                  "—"}
              </span>
            ),
          },
          {
            key:
              "calibrated_by",
            header:
              "Calibrated By",
            render: (tool) => (
              <span className="text-slate-600">
                {tool.calibrated_by ||
                  "—"}
              </span>
            ),
          },
          {
            key:
              "_certificate",
            header:
              "Certificate",
            stop: true,
            render: (tool) =>
              tool.latest_certificate ? (
                <a
                  href={`${API}/files/${tool.latest_certificate.file_id}/download`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open latest calibration certificate"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  Open
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="text-slate-400">
                  —
                </span>
              ),
          },
          {
            key: "_actions",
            header: "",
            align: "right",
            stop: true,
            render: (tool) => (
              <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                {canManage(
                  user
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAssignTarget(
                        tool
                      );
                      setAssignSearch(
                        tool.equipment_sap_no ||
                          ""
                      );
                    }}
                    title="Assign to equipment"
                    className="rounded p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                  >
                    <Link2 className="h-4 w-4" />
                  </button>
                )}

                {canEdit(user) && (
                  <button
                    type="button"
                    onClick={() =>
                      openEdit(tool)
                    }
                    title="Edit / renew calibration"
                    className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}

                {canManage(
                  user
                ) && (
                  <button
                    type="button"
                    onClick={() =>
                      archive(tool)
                    }
                    title="Archive calibration tool"
                    className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={dialog}
        onOpenChange={
          setDialog
        }
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Edit / Renew Calibration Tool"
                : "Add Calibration Tool"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Tool ID / Serial No."
              required
              value={
                form.tool_id ||
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  tool_id:
                    event.target
                      .value,
                })
              }
              data-testid="cal-tool-id"
            />

            <TextInput
              label="Tool Name / Description"
              required
              value={
                form.tool_name ||
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  tool_name:
                    event.target
                      .value,
                })
              }
              data-testid="cal-tool-name"
            />

            <div className="sm:col-span-2">
              <CategoryInput
                value={
                  form.category
                }
                options={
                  mergedCategories
                }
                onChange={(
                  value
                ) =>
                  setForm({
                    ...form,
                    category:
                      value,
                  })
                }
              />
            </div>

            <TextInput
              label="Manufacturer"
              value={
                form.manufacturer ||
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  manufacturer:
                    event.target
                      .value,
                })
              }
            />

            <TextInput
              label="Model"
              value={
                form.model || ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  model:
                    event.target
                      .value,
                })
              }
            />

            <TextInput
              label="Range / Set Pressure"
              className="sm:col-span-2"
              value={
                form.range_spec ||
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  range_spec:
                    event.target
                      .value,
                })
              }
              placeholder="Example: 0–200 bar / Set 10 bar"
            />

            <TextInput
              label="Calibration Date"
              type="date"
              value={
                form.calibration_date ||
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  calibration_date:
                    event.target
                      .value,
                })
              }
            />

            <div className="grid grid-cols-[1fr_150px] gap-2">
              <TextInput
                label="Frequency"
                type="number"
                min="1"
                value={
                  form.frequency_value ??
                  52
                }
                onChange={(event) =>
                  setForm({
                    ...form,
                    frequency_value:
                      parseInt(
                        event.target
                          .value,
                        10
                      ) || 1,
                  })
                }
              />

              <SelectInput
                label="Unit"
                value={
                  form.frequency_unit ||
                  "week"
                }
                onChange={(event) =>
                  setForm({
                    ...form,
                    frequency_unit:
                      event.target
                        .value,
                  })
                }
              >
                <option value="week">
                  Week
                </option>
                <option value="month">
                  Month
                </option>
              </SelectInput>
            </div>

            <TextInput
              label="Expired Date — auto"
              type="date"
              value={expiredDate}
              readOnly
              disabled
            />

            <div>
              <div className="mb-1 text-xs font-medium text-slate-600">
                Status
              </div>
              <div className="flex min-h-[38px] items-center rounded-md border border-slate-200 bg-slate-50 px-3">
                <StatusPill
                  value={
                    previewExpiry.status
                  }
                />
                <span className="ml-2 text-xs text-slate-500">
                  {
                    previewExpiry.text
                  }
                </span>
              </div>
            </div>

            <TextInput
              label="Certificate Number"
              value={
                form.cert_number ||
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  cert_number:
                    event.target
                      .value,
                })
              }
            />

            <TextInput
              label="Calibrated By"
              value={
                form.calibrated_by ||
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  calibrated_by:
                    event.target
                      .value,
                })
              }
            />

            <div className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-slate-700">
                    Calibration Certificate
                  </div>
                  <div className="mt-0.5 text-[11px] leading-4 text-slate-400">
                    PDF or image, maximum
                    15 MB. Uploading a new
                    certificate preserves
                    previous certificate
                    history.
                  </div>
                </div>

                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  <Upload className="h-4 w-4" />
                  Choose File
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(
                      event
                    ) =>
                      setCertificateFile(
                        event.target
                          .files?.[0] ||
                          null
                      )
                    }
                  />
                </label>
              </div>

              <div className="mt-2 text-xs text-slate-600">
                {certificateFile
                  ? certificateFile.name
                  : editing?.latest_certificate
                    ? `Current: ${editing.latest_certificate.original_filename}`
                    : "No certificate selected"}
              </div>
            </div>

            <TextArea
              label="Comments / Notes"
              className="sm:col-span-2"
              rows={3}
              value={
                form.comments ||
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  comments:
                    event.target
                      .value,
                })
              }
            />
          </div>

          <DialogFooter>
            <Btn
              variant="outline"
              onClick={() =>
                setDialog(false)
              }
            >
              Cancel
            </Btn>

            <Btn
              onClick={save}
              disabled={saving}
            >
              {saving && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {saving
                ? "Saving…"
                : "Save"}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(
          assignTarget
        )}
        onOpenChange={(
          open
        ) => {
          if (!open) {
            setAssignTarget(
              null
            );
            setAssignSearch("");
            setEquipment([]);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Assign Calibration Tool
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="font-mono font-semibold text-slate-900">
              {
                assignTarget?.tool_id
              }
            </div>
            <div className="text-slate-500">
              {
                assignTarget?.tool_name
              }
            </div>
          </div>

          {assignTarget?.equipment_sap_no && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm">
              <div>
                Current assignment:{" "}
                <span className="font-mono font-semibold text-blue-700">
                  SAP{" "}
                  {
                    assignTarget.equipment_sap_no
                  }
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  assign("")
                }
                className="inline-flex items-center gap-1 text-xs font-semibold text-red-600"
              >
                <Unlink className="h-3.5 w-3.5" />
                Unassign
              </button>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={
                assignSearch
              }
              onChange={(event) =>
                setAssignSearch(
                  event.target
                    .value
                )
              }
              placeholder="Search equipment by SAP, name, serial…"
              className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div className="max-h-[20rem] overflow-y-auto rounded-md border border-slate-200">
            {assignLoading ? (
              <div className="flex items-center justify-center p-6 text-sm text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching…
              </div>
            ) : equipment.length ? (
              <div className="divide-y divide-slate-100">
                {equipment.map(
                  (item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        assign(
                          item.sap_no
                        )
                      }
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-semibold text-blue-600">
                          SAP{" "}
                          {
                            item.sap_no
                          }
                        </div>
                        <div className="truncate text-sm text-slate-800">
                          {item.name ||
                            item.category}
                        </div>
                        <div className="truncate text-xs text-slate-400">
                          {item.category ||
                            "—"}
                          {item.mfg_no
                            ? ` · Mfg ${item.mfg_no}`
                            : ""}
                        </div>
                      </div>

                      <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  )
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-slate-400">
                No equipment found.
              </div>
            )}
          </div>

          <DialogFooter>
            <Btn
              variant="outline"
              onClick={() =>
                setAssignTarget(
                  null
                )
              }
            >
              Cancel
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
