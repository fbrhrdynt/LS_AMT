import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileBarChart, Download, Printer, FileText } from "lucide-react";
import { api, API } from "@/lib/api";
import { PageHeader, Btn, EmptyState, TextInput, SelectInput, Panel } from "@/components/Bits";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";

export default function Reports() {
  const nav = useNavigate();
  const [clients, setClients] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [f, setF] = useState({ sap_no: "", serial_no: "", technician: "", type: "", failure: "", client_id: "", job_id: "", status: "", date_from: "", date_to: "" });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api.get("/clients").then((r) => setClients(r.data));
    api.get("/jobs").then((r) => setJobs(r.data));
  }, []);

  const run = async () => {
    const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    const { data } = await api.get(`/reports/maintenance?${params}`);
    setRows(data.items); setTotal(data.total);
  };
  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const qs = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

  return (
    <div>
      <PageHeader title="Reports" subtitle="Filter and export maintenance history">
        <Btn variant="outline" onClick={() => window.open(`${API}/reports/maintenance/export.csv?${qs()}`, "_blank")} data-testid="export-csv"><Download className="h-4 w-4" /> CSV</Btn>
        <Btn variant="outline" onClick={() => window.open(`${API}/reports/maintenance/export.xlsx?${qs()}`, "_blank")} data-testid="export-xlsx"><Download className="h-4 w-4" /> Excel</Btn>
        <Btn variant="outline" onClick={() => window.print()} className="no-print" data-testid="print-btn"><Printer className="h-4 w-4" /> Print</Btn>
      </PageHeader>

      <Panel className="mb-4 p-4 no-print">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <TextInput label="Asset / SAP No." value={f.sap_no} onChange={(e) => setF({ ...f, sap_no: e.target.value })} data-testid="rf-sap" />
          <TextInput label="Serial No." value={f.serial_no} onChange={(e) => setF({ ...f, serial_no: e.target.value })} />
          <TextInput label="Technician" value={f.technician} onChange={(e) => setF({ ...f, technician: e.target.value })} />
          <TextInput label="Maintenance Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} />
          <TextInput label="Failure" value={f.failure} onChange={(e) => setF({ ...f, failure: e.target.value })} />
          <SelectInput label="Client" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">All</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectInput>
          <SelectInput label="Job" value={f.job_id} onChange={(e) => setF({ ...f, job_id: e.target.value })}>
            <option value="">All</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number}</option>)}
          </SelectInput>
          <SelectInput label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">All</option><option>Open</option><option>Closed</option>
          </SelectInput>
          <TextInput label="Date From" type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
          <TextInput label="Date To" type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
        </div>
        <div className="mt-3 flex justify-end"><Btn onClick={run} data-testid="run-report"><FileBarChart className="h-4 w-4" /> Run Report</Btn></div>
      </Panel>

      <div className="mb-2 text-sm text-slate-500">{total} record(s)</div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Maint. No.</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">SAP</th><th className="px-4 py-3">Equipment</th><th className="px-4 py-3">Failure</th><th className="px-4 py-3">Lead Tech</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 no-print"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-blue-600 cursor-pointer" onClick={() => nav(`/equipment/${m.equipment_id}`)}>{m.mnt_no}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-500">{fmtDate(m.maintenance_date)}</td>
                  <td className="px-4 py-2.5 font-mono">{m.sap_no}</td>
                  <td className="px-4 py-2.5 max-w-[14rem] truncate">{m.equipment_name}</td>
                  <td className="px-4 py-2.5 max-w-[14rem] truncate text-slate-600">{m.failure_found || m.problem_damage}</td>
                  <td className="px-4 py-2.5 text-slate-600">{m.lead_technician}</td>
                  <td className="px-4 py-2.5 text-slate-600">{m.client_name || "—"}</td>
                  <td className="px-4 py-2.5"><StatusBadge value={m.status} /></td>
                  <td className="px-4 py-2.5 no-print"><a href={`${API}/maintenance/${m.id}/report.pdf`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-blue-600"><FileText className="h-4 w-4" /></a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <EmptyState icon={FileBarChart} text="No records match filters" />}
      </div>
    </div>
  );
}
