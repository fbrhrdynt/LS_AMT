import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const fieldName = (job) => job?.field_name || job?.job_name || "";

export default function MaintenancePurposeCombobox({
  jobs = [], value = "", selectedJobId = "", clientId = "", onSelect, onClear,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || "");
  const boxRef = useRef(null);

  useEffect(() => setQuery(value || ""), [value]);
  useEffect(() => {
    const handler = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const choices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs
      .filter((job) => !["Completed", "Cancelled"].includes(job.status))
      .filter((job) => !clientId || job.client_id === clientId)
      .filter((job) => {
        if (!needle) return true;
        return [fieldName(job), job.job_number, job.client_name, job.site_location]
          .filter(Boolean)
          .some((text) => String(text).toLowerCase().includes(needle));
      })
      .slice(0, 30);
  }, [jobs, query, clientId]);

  const choose = (job) => {
    const purpose = fieldName(job);
    setQuery(purpose);
    setOpen(false);
    onSelect?.(job, purpose);
  };

  return (
    <div ref={boxRef} className="relative min-w-0">
      <label className="mb-1 block text-xs font-medium text-slate-600">Maintenance Purpose</label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={query} onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          placeholder="Search Field Name, Job ID, Client, Site…"
          className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-16 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="mf-purpose" />
        {query && <button type="button" onClick={() => { setQuery(""); setOpen(false); onClear?.(); }}
          className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>}
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
        {choices.length === 0 ? <div className="px-3 py-3 text-sm text-slate-400">No matching Field Name.</div> :
          choices.map((job) => <button key={job.id} type="button" onClick={() => choose(job)}
            className="flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50">
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${selectedJobId === job.id ? "text-blue-600" : "text-transparent"}`} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{fieldName(job) || "Unnamed Field"}</div>
              <div className="truncate font-mono text-[11px] text-slate-500">
                {job.job_number}{job.client_name ? ` · ${job.client_name}` : ""}{job.site_location ? ` · ${job.site_location}` : ""}
              </div>
            </div>
          </button>)}
      </div>}
    </div>
  );
}
