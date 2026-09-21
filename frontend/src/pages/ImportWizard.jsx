import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  API,
  api,
  formatApiError,
} from "@/lib/api";
import {
  Btn,
  PageHeader,
  Panel,
} from "@/components/Bits";


const STEPS = [
  "Template & Upload",
  "Validate & Preview",
  "Import",
  "Result",
];

const DATASETS = [
  {
    value: "equipment",
    label: "Equipment",
    description:
      "SAP / Asset register, serial number, equipment name, category, manufacturer, and purchase information.",
  },
  {
    value: "calibration",
    label: "Calibration",
    description:
      "Calibration tool master data, frequency, certificate metadata, and optional Equipment SAP assignment.",
  },
  {
    value: "inventory",
    label: "Inventory",
    description:
      "Spare Parts / Consumables, stock, minimum stock, storage location, and unit price.",
  },
];

const PREVIEW_COLUMNS = {
  equipment: [
    ["sap_no", "SAP No."],
    ["name", "Equipment"],
    ["category", "Category"],
    ["manufacturer", "Manufacturer"],
  ],
  calibration: [
    ["tool_id", "Tool ID"],
    ["tool_name", "Tool"],
    ["category", "Category"],
    ["sap_no", "Assigned SAP"],
  ],
  inventory: [
    ["item_code", "Item Code"],
    ["item_name", "Item"],
    ["category", "Category"],
    ["stock", "Stock"],
  ],
};


export default function ImportWizard() {
  const [dataset, setDataset] = useState("equipment");
  const [file, setFile] = useState(null);
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [skipDup, setSkipDup] = useState(true);
  const [createMissing, setCreateMissing] = useState([]);

  const current =
    DATASETS.find((item) => item.value === dataset) ||
    DATASETS[0];

  const selectDataset = (value) => {
    setDataset(value);
    setFile(null);
    setAnalysis(null);
    setResult(null);
    setCreateMissing([]);
    setStep(0);
  };

  const downloadTemplate = (value = dataset) => {
    window.open(
      `${API}/import/template/${value}.xlsx`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const analyze = async () => {
    if (!file) {
      toast.error("Choose an Excel file first");
      return;
    }

    setBusy(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const { data } = await api.post(
        `/import/analyze?dataset=${encodeURIComponent(dataset)}`,
        fd
      );

      setAnalysis(data);
      setCreateMissing([]);
      setStep(1);
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (analysis?.invalid) {
      toast.error("Fix invalid rows before importing");
      return;
    }

    setBusy(true);
    setStep(2);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const params = new URLSearchParams({
        dataset,
        skip_duplicates: String(skipDup),
      });

      if (
        dataset === "calibration" &&
        createMissing.length
      ) {
        params.set(
          "create_missing_saps",
          createMissing.join(",")
        );
      }

      const { data } = await api.post(
        `/import/execute?${params.toString()}`,
        fd
      );

      setResult(data);
      setStep(3);
      toast.success("Import complete");
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setStep(0);
    setAnalysis(null);
    setResult(null);
    setCreateMissing([]);
  };

  const toggleMissing = (sap) => {
    setCreateMissing((currentValues) =>
      currentValues.includes(sap)
        ? currentValues.filter((value) => value !== sap)
        : [...currentValues, sap]
    );
  };

  const missing =
    analysis?.missing_equipment || [];

  const columns =
    PREVIEW_COLUMNS[dataset] || [];

  return (
    <div>
      <PageHeader
        title="Excel Import"
        subtitle="Download an AMT template, fill it, validate it, then import Equipment, Calibration, or Inventory data."
        hideExport
      />

      <div className="mb-6 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((label, index) => (
          <div
            key={label}
            className="flex items-center gap-2"
          >
            <div
              className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
                index === step
                  ? "bg-blue-600 text-white"
                  : index < step
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {index < step ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <span className="font-mono">
                  {index + 1}
                </span>
              )}
              {label}
            </div>

            {index < STEPS.length - 1 && (
              <ArrowRight className="h-4 w-4 text-slate-300" />
            )}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <Panel title="1. Choose Import Type & Download Template">
            <div className="grid gap-3 p-4 lg:grid-cols-3">
              {DATASETS.map((item) => {
                const selected =
                  item.value === dataset;

                return (
                  <div
                    key={item.value}
                    className={`rounded-lg border p-4 ${
                      selected
                        ? "border-blue-400 bg-blue-50/50"
                        : "border-slate-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        selectDataset(item.value)
                      }
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-2 font-semibold text-slate-900">
                        <FileSpreadsheet className="h-4 w-4 text-blue-600" />
                        {item.label}
                      </div>

                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        {item.description}
                      </p>
                    </button>

                    <Btn
                      variant="outline"
                      className="mt-4 w-full"
                      onClick={() =>
                        downloadTemplate(item.value)
                      }
                    >
                      <Download className="h-4 w-4" />
                      Download Template
                    </Btn>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title={`2. Upload ${current.label} Template`}>
            <div className="p-4">
              <label
                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-slate-200 py-12 transition-colors hover:border-blue-400"
                data-testid="import-dropzone"
              >
                <FileSpreadsheet className="h-10 w-10 text-slate-400" />

                <span className="text-sm text-slate-600">
                  {file
                    ? file.name
                    : `Choose the completed ${current.label} .xlsx template`}
                </span>

                <input
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(event) =>
                    setFile(
                      event.target.files?.[0] || null
                    )
                  }
                  data-testid="import-file-input"
                />
              </label>

              <div className="mt-4 flex flex-wrap justify-between gap-2">
                <Btn
                  variant="outline"
                  onClick={() => downloadTemplate()}
                >
                  <Download className="h-4 w-4" />
                  Download {current.label} Template
                </Btn>

                <Btn
                  onClick={analyze}
                  disabled={busy || !file}
                  data-testid="import-analyze-btn"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Validate & Preview
                </Btn>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {step === 1 && analysis && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Total Rows"
              value={analysis.total}
            />
            <Metric
              label="New"
              value={analysis.new}
              tone="green"
            />
            <Metric
              label="Duplicates"
              value={analysis.duplicates}
              tone="amber"
            />
            <Metric
              label="Invalid"
              value={analysis.invalid}
              tone={analysis.invalid ? "red" : "slate"}
            />
          </div>

          {analysis.invalid > 0 && (
            <Panel title="Rows Requiring Correction">
              <div className="p-4">
                <div className="mb-3 flex items-start gap-2 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Correct these rows in Excel, save the file, then validate again.
                </div>

                <div className="space-y-1 font-mono text-xs text-slate-600">
                  {(analysis.errors || []).map((error) => (
                    <div
                      key={`${error.row}-${error.message}`}
                    >
                      Row {error.row}: {error.message}
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {dataset === "calibration" &&
            missing.length > 0 && (
              <Panel title="Missing Equipment SAP Numbers">
                <div className="p-4">
                  <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Some Calibration rows reference Equipment SAP numbers that do not exist.
                    Choose whether AMT should create each Equipment automatically.
                    Unselected rows will be skipped during Calibration import.
                  </div>

                  <div className="space-y-2">
                    {missing.map((item) => (
                      <label
                        key={item.sap_no}
                        className="flex items-start gap-3 rounded-md border border-slate-200 p-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={createMissing.includes(
                            item.sap_no
                          )}
                          onChange={() =>
                            toggleMissing(item.sap_no)
                          }
                        />

                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            Equipment SAP No. {item.sap_no} is not available. Create equipment as part of this import?
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            Equipment name: {item.equipment_name || "Imported Equipment"}
                            {" · "}Initial location: Base
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Btn
                      variant="outline"
                      onClick={() =>
                        setCreateMissing(
                          missing.map((item) => item.sap_no)
                        )
                      }
                    >
                      Create All Missing Equipment
                    </Btn>

                    <Btn
                      variant="ghost"
                      onClick={() => setCreateMissing([])}
                    >
                      Skip All Missing Equipment
                    </Btn>
                  </div>
                </div>
              </Panel>
            )}

          <Panel title="Preview (first rows)">
            <div className="overflow-x-auto p-4">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-slate-400">
                  <tr>
                    {columns.map(([key, label]) => (
                      <th
                        key={key}
                        className="pb-2 pr-4"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {(analysis.sample || []).map((row, index) => (
                    <tr key={index}>
                      {columns.map(([key]) => (
                        <td
                          key={key}
                          className="py-1.5 pr-4"
                        >
                          {String(row[key] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={skipDup}
              onChange={(event) =>
                setSkipDup(event.target.checked)
              }
              data-testid="skip-dup"
            />
            Skip duplicate records (recommended)
          </label>

          <div className="flex justify-between gap-2">
            <Btn
              variant="outline"
              onClick={reset}
            >
              Start Over
            </Btn>

            <Btn
              onClick={execute}
              disabled={busy || analysis.invalid > 0}
              data-testid="import-execute-btn"
            >
              Import {current.label}
              <ArrowRight className="h-4 w-4" />
            </Btn>
          </div>
        </div>
      )}

      {step === 2 && (
        <Panel className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-slate-500">
            Importing…
          </p>
        </Panel>
      )}

      {step === 3 && result && (
        <Panel className="p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />

          <h3 className="mt-3 font-heading text-xl font-bold">
            Import Complete
          </h3>

          <p className="mt-1 text-sm text-slate-500">
            {current.label} import finished successfully.
          </p>

          <div className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Added"
              value={result.added}
              tone="green"
            />
            <Metric
              label="Duplicates Skipped"
              value={result.skipped_duplicates}
              tone="amber"
            />
            <Metric
              label="Missing SAP Skipped"
              value={result.skipped_missing_equipment}
              tone="amber"
            />
            <Metric
              label="Equipment Created"
              value={result.equipment_created}
              tone="green"
            />
          </div>

          <div className="mt-6">
            <Btn
              onClick={reset}
              data-testid="import-again"
            >
              Import Another File
            </Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}


function Metric({
  label,
  value,
  tone = "slate",
}) {
  const colors = {
    slate: "text-slate-900",
    green: "text-green-600",
    amber: "text-amber-600",
    red: "text-red-600",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
      <div
        className={`font-mono text-2xl font-bold ${
          colors[tone] || colors.slate
        }`}
      >
        {value ?? 0}
      </div>

      <div className="mt-1 text-xs text-slate-400">
        {label}
      </div>
    </div>
  );
}
