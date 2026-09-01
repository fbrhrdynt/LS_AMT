import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { api, API } from "@/lib/api";
import { PageHeader, SelectInput } from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";
import DataTable from "@/components/DataTable";

export default function MaintenanceList() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") || "");
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    const { data } = await api.get(`/maintenance?status=${status}&page_size=5000`);
    setItems(data.items);
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Maintenance" subtitle="All maintenance records, newest first">
        <SelectInput value={status} onChange={(e) => setStatus(e.target.value)} data-testid="mnt-filter-status">
          <option value="">All Statuses</option>
          <option value="Open">Open</option>
          <option value="Closed">Closed</option>
        </SelectInput>
      </PageHeader>

      <DataTable
        data={items}
        searchKeys={["mnt_no", "equipment_name", "sap_no", "problem_damage", "lead_technician"]}
        searchPlaceholder="Search MNT no, equipment, SAP, problem, technician…"
        testIdPrefix="mnt"
        rowTestId={(m) => `mnt-row-${m.id}`}
        minWidth="820px"
        emptyText="No maintenance records"
        columns={[
          { key: "mnt_no", header: "Maint. No.", render: (m) => <span className="cursor-pointer font-mono font-medium text-blue-600" onClick={() => nav(`/equipment/${m.equipment_id}`)}>{m.mnt_no}</span> },
          { key: "maintenance_date", header: "Date", render: (m) => <span className="font-mono text-slate-500">{fmtDate(m.maintenance_date)}</span> },
          { key: "equipment_name", header: "Equipment", render: (m) => <span className="block max-w-[16rem] cursor-pointer truncate text-slate-900" onClick={() => nav(`/equipment/${m.equipment_id}`)}>{m.equipment_name || m.sap_no}</span> },
          { key: "problem_damage", header: "Problem / Failure", hideOnMobile: true, render: (m) => <span className="block max-w-[18rem] truncate text-slate-600">{m.problem_damage || "—"}</span> },
          { key: "lead_technician", header: "Lead Tech", hideOnMobile: true, render: (m) => <span className="text-slate-600">{m.lead_technician || "—"}</span> },
          { key: "status", header: "Status", render: (m) => <StatusBadge value={m.status} /> },
          { key: "_pdf", header: "", stop: true, render: (m) => (
            <a href={`${API}/maintenance/${m.id}/report.pdf`} target="_blank" rel="noreferrer" title="PDF report" data-testid={`mnt-pdf-${m.id}`}
              className="inline-flex text-slate-400 hover:text-blue-600"><FileText className="h-4 w-4" /></a>
          ) },
        ]}
      />
    </div>
  );
}
