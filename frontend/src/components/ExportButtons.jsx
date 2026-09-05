import { FileSpreadsheet, FileText } from "lucide-react";
import { API } from "@/lib/api";

export default function ExportButtons({ dataset, query = "", compact = false }) {
  if (!dataset) return null;
  const suffix = query ? `?${query.replace(/^\?/, "")}` : "";
  const open = (format) => window.open(
    `${API}/export/${dataset}.${format}${suffix}`,
    "_blank",
    "noopener,noreferrer"
  );
  const base = "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={() => open("xlsx")}
        className={`${base} ${compact ? "h-9 w-9 px-0 sm:w-auto sm:px-2.5" : "min-h-9 px-2.5 py-1.5 text-xs"}`}
        title="Export Excel">
        <FileSpreadsheet className="h-4 w-4" />
        <span className={compact ? "hidden sm:inline" : ""}>Excel</span>
      </button>
      <button type="button" onClick={() => open("pdf")}
        className={`${base} ${compact ? "h-9 w-9 px-0 sm:w-auto sm:px-2.5" : "min-h-9 px-2.5 py-1.5 text-xs"}`}
        title="Export PDF">
        <FileText className="h-4 w-4" />
        <span className={compact ? "hidden sm:inline" : ""}>PDF</span>
      </button>
    </div>
  );
}
