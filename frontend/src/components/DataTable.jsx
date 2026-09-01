import { useState, useMemo } from "react";
import { Search, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable responsive data table with client-side search + pagination.
 * columns: [{ key, header, render?(row), className?, align?, hideOnMobile?, stop? }]
 */
export default function DataTable({
  data = [], columns = [], searchKeys = [], searchPlaceholder = "Search…",
  pageSize = 15, onRowClick, rowTestId, minWidth = "760px", toolbar,
  emptyText = "No records", testIdPrefix = "dt",
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!q || searchKeys.length === 0) return data;
    const s = q.toLowerCase();
    return data.filter((row) =>
      searchKeys.some((k) => String(row[k] ?? "").toLowerCase().includes(s))
    );
  }, [data, q, searchKeys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const rows = filtered.slice((curPage - 1) * pageSize, curPage * pageSize);

  const align = (a) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        {searchKeys.length > 0 && (
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={searchPlaceholder}
              data-testid={`${testIdPrefix}-search`}
              className="w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
        {toolbar && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{toolbar}</div>}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth }}>
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={cn("px-4 py-3", align(c.align), c.hideOnMobile && "hidden md:table-cell", c.thClassName)}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => (
                <tr key={row.id || i} data-testid={rowTestId ? rowTestId(row) : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && "cursor-pointer", "hover:bg-slate-50 transition-colors")}>
                  {columns.map((c) => (
                    <td key={c.key}
                      onClick={c.stop ? (e) => e.stopPropagation() : undefined}
                      className={cn("px-4 py-3", align(c.align), c.hideOnMobile && "hidden md:table-cell", c.className)}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
            <Inbox className="h-8 w-8" /><p className="text-sm">{emptyText}</p>
          </div>
        )}
      </div>

      {filtered.length > pageSize && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {(curPage - 1) * pageSize + 1}–{Math.min(curPage * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button disabled={curPage <= 1} onClick={() => setPage((p) => p - 1)} data-testid={`${testIdPrefix}-prev`}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-xs text-slate-500">Page {curPage}/{totalPages}</span>
            <button disabled={curPage >= totalPages} onClick={() => setPage((p) => p + 1)} data-testid={`${testIdPrefix}-next`}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
