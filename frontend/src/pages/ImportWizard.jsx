import { useState } from "react";
import { Upload, CheckCircle2, FileSpreadsheet, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, Btn, Panel } from "@/components/Bits";

const STEPS = ["Upload", "Validate & Preview", "Import", "Result"];

export default function ImportWizard() {
  const [file, setFile] = useState(null);
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [skipDup, setSkipDup] = useState(true);

  const analyze = async () => {
    if (!file) { toast.error("Choose an Excel file first"); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/import/analyze", fd);
      setAnalysis(data); setStep(1);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  const execute = async () => {
    setBusy(true); setStep(2);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`/import/execute?skip_duplicates=${skipDup}`, fd);
      setResult(data); setStep(3);
      toast.success("Import complete");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); setStep(1); }
    finally { setBusy(false); }
  };

  const reset = () => { setFile(null); setStep(0); setAnalysis(null); setResult(null); };

  return (
    <div>
      <PageHeader title="Excel Import" subtitle="Migrate equipment & maintenance history from Dashboard Project.xlsx" />

      <div className="mb-6 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${i === step ? "bg-blue-600 text-white" : i < step ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"}`}>
              {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="font-mono">{i + 1}</span>} {s}
            </div>
            {i < STEPS.length - 1 && <ArrowRight className="h-4 w-4 text-slate-300" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Panel className="p-8">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-slate-200 py-14 hover:border-blue-400 transition-colors" data-testid="import-dropzone">
            <FileSpreadsheet className="h-10 w-10 text-slate-400" />
            <span className="text-sm text-slate-600">{file ? file.name : "Click to choose an .xlsx file"}</span>
            <input type="file" accept=".xlsx" className="hidden" onChange={(e) => setFile(e.target.files[0])} data-testid="import-file-input" />
          </label>
          <div className="mt-4 flex justify-end">
            <Btn onClick={analyze} disabled={busy || !file} data-testid="import-analyze-btn">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Validate & Preview</Btn>
          </div>
        </Panel>
      )}

      {step === 1 && analysis && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {[["Equipment", analysis.equipment], ["Maintenance", analysis.maintenance]].map(([label, a]) => (
              <Panel key={label} title={label} className="p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><div className="font-mono text-xl font-bold">{a.total}</div><div className="text-xs text-slate-400">Total rows</div></div>
                  <div><div className="font-mono text-xl font-bold text-green-600">{a.new}</div><div className="text-xs text-slate-400">New</div></div>
                  <div><div className="font-mono text-xl font-bold text-amber-600">{a.duplicates}</div><div className="text-xs text-slate-400">Duplicates</div></div>
                </div>
              </Panel>
            ))}
          </div>
          <Panel title="Preview (first rows)">
            <div className="overflow-x-auto p-4">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-400"><tr><th className="pb-2 pr-4">SAP No.</th><th className="pb-2 pr-4">Equipment</th><th className="pb-2 pr-4">Category</th><th className="pb-2">Manufacturer</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {analysis.equipment.sample.map((r, i) => (
                    <tr key={i}><td className="py-1.5 pr-4 font-mono">{r.sap_no}</td><td className="py-1.5 pr-4 max-w-xs truncate">{r.name}</td><td className="py-1.5 pr-4">{r.category}</td><td className="py-1.5">{r.manufacturer}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} data-testid="skip-dup" /> Skip duplicate records (recommended — preserves existing history)</label>
          <div className="flex justify-between">
            <Btn variant="outline" onClick={reset}>Start Over</Btn>
            <Btn onClick={execute} disabled={busy} data-testid="import-execute-btn">Import Now <ArrowRight className="h-4 w-4" /></Btn>
          </div>
        </div>
      )}

      {step === 2 && <Panel className="flex flex-col items-center gap-3 py-16"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /><p className="text-sm text-slate-500">Importing…</p></Panel>}

      {step === 3 && result && (
        <Panel className="p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
          <h3 className="mt-3 font-heading text-xl font-bold">Import Complete</h3>
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div><div className="font-mono text-2xl font-bold text-green-600">{result.equipment_added}</div><div className="text-xs text-slate-400">Equipment added</div></div>
            <div><div className="font-mono text-2xl font-bold text-green-600">{result.maintenance_added}</div><div className="text-xs text-slate-400">Maintenance added</div></div>
            <div><div className="font-mono text-2xl font-bold text-amber-600">{result.maintenance_skipped}</div><div className="text-xs text-slate-400">Skipped (dupes)</div></div>
          </div>
          <div className="mt-6"><Btn onClick={reset} data-testid="import-again">Import Another File</Btn></div>
        </Panel>
      )}
    </div>
  );
}
