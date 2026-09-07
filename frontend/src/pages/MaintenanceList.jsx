import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { FileText } from "lucide-react";

import { api, API } from "@/lib/api";
import {
  PageHeader,
  SelectInput,
} from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";
import DataTable from "@/components/DataTable";


export default function MaintenanceList() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState(
    searchParams.get("status") || ""
  );
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    const { data } = await api.get(
      `/maintenance?status=${encodeURIComponent(
        status
      )}&page_size=200`
    );

    setItems(data.items || []);
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="All maintenance records, newest first"
      >
        <SelectInput
          value={status}
          onChange={(event) =>
            setStatus(event.target.value)
          }
          data-testid="mnt-filter-status"
        >
          <option value="">All Statuses</option>
          <option value="Open">Open</option>
          <option value="Closed">Closed</option>
        </SelectInput>
      </PageHeader>

      <DataTable
        data={items}
        searchKeys={[
          "mnt_no",
          "equipment_name",
          "sap_no",
          "field_name",
          "problem_damage",
          "failure_found",
          "lead_technician",
        ]}
        searchPlaceholder="Search MNT no, equipment, SAP, Field Name, symptoms, technician…"
        testIdPrefix="mnt"
        rowTestId={(maintenance) =>
          `mnt-row-${maintenance.id}`
        }
        minWidth="1050px"
        emptyText="No maintenance records"
        columns={[
          {
            key: "mnt_no",
            header: "Maint. No.",
            render: (maintenance) => (
              <span
                className="cursor-pointer font-mono font-medium text-blue-600"
                onClick={() =>
                  nav(
                    `/equipment/${maintenance.equipment_id}`
                  )
                }
              >
                {maintenance.mnt_no}
              </span>
            ),
          },
          {
            key: "maintenance_date",
            header: "Date",
            render: (maintenance) => (
              <span className="font-mono text-slate-500">
                {fmtDate(
                  maintenance.maintenance_date
                )}
              </span>
            ),
          },
          {
            key: "equipment_name",
            header: "Equipment",
            render: (maintenance) => (
              <span
                className="block max-w-[16rem] cursor-pointer truncate text-slate-900"
                onClick={() =>
                  nav(
                    `/equipment/${maintenance.equipment_id}`
                  )
                }
              >
                {maintenance.equipment_name ||
                  maintenance.sap_no}
              </span>
            ),
          },
          {
            key: "field_name",
            header: "Field Name",
            render: (maintenance) => (
              <span className="block max-w-[14rem] truncate text-slate-700">
                {maintenance.field_name || "—"}
              </span>
            ),
          },
          {
            key: "problem_damage",
            header: "Observed Symptoms / Failure",
            hideOnMobile: true,
            render: (maintenance) => (
              <span className="block max-w-[18rem] truncate text-slate-600">
                {maintenance.problem_damage ||
                  maintenance.failure_found ||
                  "—"}
              </span>
            ),
          },
          {
            key: "lead_technician",
            header: "Lead Tech",
            hideOnMobile: true,
            render: (maintenance) => (
              <span className="text-slate-600">
                {maintenance.lead_technician ||
                  "—"}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (maintenance) => (
              <StatusBadge
                value={maintenance.status}
              />
            ),
          },
          {
            key: "_pdf",
            header: "",
            stop: true,
            render: (maintenance) => (
              <a
                href={`${API}/maintenance/${maintenance.id}/report.pdf`}
                target="_blank"
                rel="noreferrer"
                title="PDF report"
                data-testid={`mnt-pdf-${maintenance.id}`}
                className="inline-flex text-slate-400 hover:text-blue-600"
              >
                <FileText className="h-4 w-4" />
              </a>
            ),
          },
        ]}
      />
    </div>
  );
}
