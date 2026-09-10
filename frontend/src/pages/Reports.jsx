import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileBarChart,
  FileSpreadsheet,
  Printer,
  FileText,
} from "lucide-react";

import { api, API } from "@/lib/api";
import {
  PageHeader,
  Btn,
  EmptyState,
  TextInput,
  SelectInput,
  Panel,
} from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";


export default function Reports() {
  const nav = useNavigate();

  const [clients, setClients] = useState([]);
  const [jobs, setJobs] = useState([]);

  const [f, setF] = useState({
    sap_no: "",
    serial_no: "",
    technician: "",
    type: "",
    failure: "",
    client_id: "",
    job_id: "",
    status: "",
    date_from: "",
    date_to: "",
  });

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  const [
    selectedIds,
    setSelectedIds,
  ] = useState(
    new Set()
  );

  useEffect(() => {
    api
      .get("/clients")
      .then((response) =>
        setClients(response.data)
      );

    api
      .get("/jobs")
      .then((response) =>
        setJobs(response.data)
      );
  }, []);

  const run = async () => {
    const params = new URLSearchParams(
      Object.entries(f).filter(
        ([, value]) => value
      )
    );

    const { data } = await api.get(
      `/reports/maintenance?${params}`
    );

    setRows(data.items);
    setTotal(data.total);
    setSelectedIds(
      new Set()
    );
  };

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportQs =
    (selectedOnly = false) => {
      const params =
        new URLSearchParams(
          Object.entries(f).filter(
            ([, value]) => value
          )
        );

      if (
        selectedOnly &&
        selectedIds.size > 0
      ) {
        params.set(
          "maintenance_ids",
          Array.from(
            selectedIds
          ).join(",")
        );
      }

      return params.toString();
    };

  const toggleOne =
    (id) => {
      setSelectedIds(
        (current) => {
          const next =
            new Set(current);

          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }

          return next;
        }
      );
    };

  const allVisibleSelected =
    rows.length > 0 &&
    rows.every(
      (row) =>
        selectedIds.has(
          row.id
        )
    );

  const toggleAllVisible =
    () => {
      setSelectedIds(
        (current) => {
          const next =
            new Set(current);

          if (allVisibleSelected) {
            rows.forEach(
              (row) =>
                next.delete(
                  row.id
                )
            );
          } else {
            rows.forEach(
              (row) =>
                next.add(
                  row.id
                )
            );
          }

          return next;
        }
      );
    };

  const exportMaintenance =
    (
      extension,
      selectedOnly = false
    ) => {
      window.open(
        `${API}/export/maintenance.${extension}?${exportQs(selectedOnly)}`,
        "_blank"
      );
    };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Filter and export maintenance history"
      >
        <Btn
          variant="outline"
          onClick={() =>
            exportMaintenance(
              "xlsx"
            )
          }
        >
          <FileSpreadsheet className="h-4 w-4" />
          Excel
        </Btn>

        <Btn
          variant="outline"
          onClick={() =>
            exportMaintenance(
              "pdf"
            )
          }
        >
          <FileText className="h-4 w-4" />
          PDF
        </Btn>

        <Btn
          variant="outline"
          onClick={() => window.print()}
          className="no-print"
        >
          <Printer className="h-4 w-4" />
          Print
        </Btn>
      </PageHeader>

      <Panel className="mb-4 p-4 no-print">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <TextInput
            label="Asset / SAP No."
            value={f.sap_no}
            onChange={(e) =>
              setF({
                ...f,
                sap_no: e.target.value,
              })
            }
          />

          <TextInput
            label="Serial No."
            value={f.serial_no}
            onChange={(e) =>
              setF({
                ...f,
                serial_no: e.target.value,
              })
            }
          />

          <TextInput
            label="Technician"
            value={f.technician}
            onChange={(e) =>
              setF({
                ...f,
                technician: e.target.value,
              })
            }
          />

          <TextInput
            label="Maintenance Type"
            value={f.type}
            onChange={(e) =>
              setF({
                ...f,
                type: e.target.value,
              })
            }
          />

          <TextInput
            label="Failure"
            value={f.failure}
            onChange={(e) =>
              setF({
                ...f,
                failure: e.target.value,
              })
            }
          />

          <SelectInput
            label="Client"
            value={f.client_id}
            onChange={(e) =>
              setF({
                ...f,
                client_id: e.target.value,
              })
            }
          >
            <option value="">All</option>
            {clients.map((client) => (
              <option
                key={client.id}
                value={client.id}
              >
                {client.name}
              </option>
            ))}
          </SelectInput>

          <SelectInput
            label="Field Name / Job"
            value={f.job_id}
            onChange={(e) =>
              setF({
                ...f,
                job_id: e.target.value,
              })
            }
          >
            <option value="">All</option>
            {jobs.map((job) => (
              <option
                key={job.id}
                value={job.id}
              >
                {job.field_name ||
                  job.job_name ||
                  job.job_number}
              </option>
            ))}
          </SelectInput>

          <SelectInput
            label="Status"
            value={f.status}
            onChange={(e) =>
              setF({
                ...f,
                status: e.target.value,
              })
            }
          >
            <option value="">All</option>
            <option>Open</option>
            <option>Closed</option>
          </SelectInput>

          <TextInput
            label="Date From"
            type="date"
            value={f.date_from}
            onChange={(e) =>
              setF({
                ...f,
                date_from: e.target.value,
              })
            }
          />

          <TextInput
            label="Date To"
            type="date"
            value={f.date_to}
            onChange={(e) =>
              setF({
                ...f,
                date_to: e.target.value,
              })
            }
          />
        </div>

        <div className="mt-3 flex justify-end">
          <Btn onClick={run}>
            <FileBarChart className="h-4 w-4" />
            Run Report
          </Btn>
        </div>
      </Panel>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
        <span>
          {total} record(s)
          {selectedIds.size > 0
            ? ` · ${selectedIds.size} selected`
            : ""}
        </span>
        <span className="no-print text-xs text-slate-400">
          Select maintenance rows to export only the records you need.
        </span>
      </div>

      {selectedIds.size > 0 && (
        <Panel className="mb-3 p-3 no-print">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-700">
              {selectedIds.size} maintenance record(s) selected
            </div>

            <div className="flex flex-wrap gap-2">
              <Btn
                variant="outline"
                onClick={() =>
                  setSelectedIds(
                    new Set()
                  )
                }
              >
                Clear Selection
              </Btn>

              <Btn
                variant="outline"
                onClick={() =>
                  exportMaintenance(
                    "xlsx",
                    true
                  )
                }
              >
                <FileSpreadsheet className="h-4 w-4" />
                Export Selected Excel
              </Btn>

              <Btn
                variant="outline"
                onClick={() =>
                  exportMaintenance(
                    "pdf",
                    true
                  )
                }
              >
                <FileText className="h-4 w-4" />
                Export Selected PDF
              </Btn>
            </div>
          </div>
        </Panel>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                <th className="w-12 px-4 py-3 no-print">
                  <input
                    type="checkbox"
                    checked={
                      allVisibleSelected
                    }
                    onChange={
                      toggleAllVisible
                    }
                    aria-label="Select all visible maintenance"
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>

                <th className="px-4 py-3">
                  Maint. No.
                </th>
                <th className="px-4 py-3">
                  Date
                </th>
                <th className="px-4 py-3">
                  SAP
                </th>
                <th className="px-4 py-3">
                  Equipment
                </th>
                <th className="px-4 py-3">
                  Purpose
                </th>
                <th className="px-4 py-3">
                  Failure
                </th>
                <th className="px-4 py-3">
                  Lead Tech
                </th>
                <th className="px-4 py-3">
                  Client
                </th>
                <th className="px-4 py-3">
                  Status
                </th>
                <th className="px-4 py-3 no-print" />
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {rows.map((maintenance) => (
                <tr
                  key={maintenance.id}
                  className="hover:bg-slate-50"
                >
                  <td className="w-12 px-4 py-2.5 no-print">
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.has(
                          maintenance.id
                        )
                      }
                      onChange={() =>
                        toggleOne(
                          maintenance.id
                        )
                      }
                      aria-label={`Select ${maintenance.mnt_no}`}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>

                  <td
                    className="cursor-pointer px-4 py-2.5 font-mono text-blue-600"
                    onClick={() =>
                      nav(
                        `/equipment/${maintenance.equipment_id}`
                      )
                    }
                  >
                    {maintenance.mnt_no}
                  </td>

                  <td className="px-4 py-2.5 font-mono text-slate-500">
                    {fmtDate(
                      maintenance.maintenance_date
                    )}
                  </td>

                  <td className="px-4 py-2.5 font-mono">
                    {maintenance.sap_no}
                  </td>

                  <td className="max-w-[14rem] truncate px-4 py-2.5">
                    {maintenance.equipment_name}
                  </td>

                  <td className="max-w-[12rem] truncate px-4 py-2.5 text-slate-600">
                    {maintenance.maintenance_purpose ||
                      "—"}
                  </td>

                  <td className="max-w-[14rem] truncate px-4 py-2.5 text-slate-600">
                    {maintenance.failure_found ||
                      maintenance.problem_damage ||
                      "—"}
                  </td>

                  <td className="px-4 py-2.5 text-slate-600">
                    {maintenance.lead_technician ||
                      "—"}
                  </td>

                  <td className="px-4 py-2.5 text-slate-600">
                    {maintenance.client_name ||
                      "—"}
                  </td>

                  <td className="px-4 py-2.5">
                    <StatusBadge
                      value={maintenance.status}
                    />
                  </td>

                  <td className="px-4 py-2.5 no-print">
                    <a
                      href={`${API}/maintenance/${maintenance.id}/report.pdf`}
                      target="_blank"
                      rel="noreferrer"
                      title="Open maintenance PDF"
                      className="text-slate-400 hover:text-blue-600"
                    >
                      <FileText className="h-4 w-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <EmptyState
            icon={FileBarChart}
            text="No records match filters"
          />
        )}
      </div>
    </div>
  );
}
