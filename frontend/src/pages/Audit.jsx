import { useEffect, useState } from "react";
import { PageHeader, SelectInput } from "@/components/Bits";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/helpers";
import DataTable from "@/components/DataTable";

const ENTITIES = ["equipment", "maintenance", "assignment", "inventory", "job", "client", "user", "file", "import"];

const ACTION_COLOR = (a) => {
  if (a.includes("delete") || a.includes("reopen")) return "bg-red-100 text-red-700";
  if (a.includes("close") || a.includes("create")) return "bg-green-100 text-green-700";
  if (a.includes("move") || a.includes("mobilize") || a.includes("demobilize")) return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-600";
};

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [entity, setEntity] = useState("");

  useEffect(() => {
    api.get(`/audit?entity_type=${entity}&limit=300`).then((r) => setLogs(r.data));
  }, [entity]);

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Immutable log of important actions">
        <SelectInput value={entity} onChange={(e) => setEntity(e.target.value)} data-testid="audit-filter">
          <option value="">All Entities</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </SelectInput>
      </PageHeader>

      <DataTable
        data={logs}
        searchKeys={["action", "entity_type", "details", "user_name"]}
        searchPlaceholder="Search action, entity, details, user…"
        testIdPrefix="audit"
        rowTestId={(l) => `audit-row-${l.id}`}
        pageSize={20}
        minWidth="720px"
        emptyText="No audit records"
        columns={[
          { key: "timestamp", header: "When", render: (l) => <span className="whitespace-nowrap font-mono text-xs text-slate-500">{fmtDateTime(l.timestamp)}</span> },
          { key: "action", header: "Action", render: (l) => <span className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${ACTION_COLOR(l.action)}`}>{l.action}</span> },
          { key: "entity_type", header: "Entity", className: "text-slate-600" },
          { key: "details", header: "Details", render: (l) => <span className="block max-w-md truncate text-slate-700">{l.details}</span> },
          { key: "user_name", header: "User", className: "text-slate-600" },
        ]}
      />
    </div>
  );
}
