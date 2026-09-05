import { useState, useMemo } from "react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable responsive data table with client-side search + pagination.
 *
 * columns:
 * [{
 *   key,
 *   header,
 *   render?(row),
 *   className?,
 *   thClassName?,
 *   align?,
 *   hideOnMobile?,
 *   stop?
 * }]
 */
export default function DataTable({
  data = [],
  columns = [],
  searchKeys = [],
  searchPlaceholder = "Search…",
  pageSize = 15,
  onRowClick,
  rowTestId,
  minWidth = "760px",
  toolbar,
  emptyText = "No records",
  testIdPrefix = "dt",
  compact = false,
  maxHeight,
  embedded = false,
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!q || searchKeys.length === 0) {
      return data;
    }

    const search = q.toLowerCase();

    return data.filter((row) =>
      searchKeys.some((key) =>
        String(row[key] ?? "")
          .toLowerCase()
          .includes(search)
      )
    );
  }, [data, q, searchKeys]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / pageSize)
  );

  const curPage = Math.min(
    page,
    totalPages
  );

  const rows = filtered.slice(
    (curPage - 1) * pageSize,
    curPage * pageSize
  );

  const align = (value) => {
    if (value === "right") {
      return "text-right";
    }

    if (value === "center") {
      return "text-center";
    }

    return "text-left";
  };

  const cellPadding = compact
    ? "px-3 py-2.5"
    : "px-4 py-3";

  return (
    <div>
      {(searchKeys.length > 0 ||
        toolbar) && (
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          {searchKeys.length > 0 && (
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <input
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  setPage(1);
                }}
                placeholder={
                  searchPlaceholder
                }
                data-testid={`${testIdPrefix}-search`}
                className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {toolbar && (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              {toolbar}
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          "bg-white",
          embedded
            ? "overflow-hidden"
            : "overflow-hidden rounded-lg border border-slate-200"
        )}
      >
        <div
          className={cn(
            "overflow-x-auto",
            maxHeight &&
              "overflow-y-auto"
          )}
          style={
            maxHeight
              ? { maxHeight }
              : undefined
          }
        >
          <table
            className="w-full text-sm"
            style={{ minWidth }}
          >
            <thead className="sticky top-0 z-[1] bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map(
                  (column) => (
                    <th
                      key={column.key}
                      className={cn(
                        cellPadding,
                        align(
                          column.align
                        ),
                        column.hideOnMobile &&
                          "hidden md:table-cell",
                        column.thClassName
                      )}
                    >
                      {column.header}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {rows.map(
                (row, index) => (
                  <tr
                    key={row.id || index}
                    data-testid={
                      rowTestId
                        ? rowTestId(row)
                        : undefined
                    }
                    onClick={
                      onRowClick
                        ? () =>
                            onRowClick(
                              row
                            )
                        : undefined
                    }
                    className={cn(
                      onRowClick &&
                        "cursor-pointer",
                      "transition-colors hover:bg-slate-50"
                    )}
                  >
                    {columns.map(
                      (column) => (
                        <td
                          key={
                            column.key
                          }
                          onClick={
                            column.stop
                              ? (
                                  event
                                ) =>
                                  event.stopPropagation()
                              : undefined
                          }
                          className={cn(
                            cellPadding,
                            align(
                              column.align
                            ),
                            column.hideOnMobile &&
                              "hidden md:table-cell",
                            column.className
                          )}
                        >
                          {column.render
                            ? column.render(
                                row
                              )
                            : row[
                                column
                                  .key
                              ]}
                        </td>
                      )
                    )}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400">
            <Inbox className="h-8 w-8" />
            <p className="text-sm">
              {emptyText}
            </p>
          </div>
        )}
      </div>

      {filtered.length > pageSize && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {(curPage - 1) *
              pageSize +
              1}
            –
            {Math.min(
              curPage * pageSize,
              filtered.length
            )}{" "}
            of {filtered.length}
          </span>

          <div className="flex items-center gap-2">
            <button
              disabled={curPage <= 1}
              onClick={() =>
                setPage(
                  (value) =>
                    value - 1
                )
              }
              data-testid={`${testIdPrefix}-prev`}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <span className="text-xs text-slate-500">
              Page {curPage}/
              {totalPages}
            </span>

            <button
              disabled={
                curPage >=
                totalPages
              }
              onClick={() =>
                setPage(
                  (value) =>
                    value + 1
                )
              }
              data-testid={`${testIdPrefix}-next`}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
