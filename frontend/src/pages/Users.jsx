import { useEffect, useState } from "react";
import { Users as UsersIcon, Plus, Trash2, Coins, Download, Code2, Database } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import { CURRENCIES } from "@/lib/currencies";
import CurrencyCombobox from "@/components/CurrencyCombobox";
import { PageHeader, Btn, EmptyState, TextInput, SelectInput, Panel } from "@/components/Bits";
import { RoleBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/helpers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const ROLES = ["admin", "supervisor", "technician", "viewer"];
const empty = { email: "", name: "", password: "", role: "technician" };

export default function UsersPage() {
  const { user } = useAuth();
  const { currency, setCurrency, format } = useCurrency();
  const [users, setUsers] = useState([]);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(empty);

  const load = async () => {
    try { const { data } = await api.get("/users"); setUsers(data); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Failed to load users"); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.email || !form.password) { toast.error("Email and password required"); return; }
    try {
      await api.post("/users", form);
      toast.success("User created"); setDialog(false); setForm(empty); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const changeRole = async (id, role) => {
    try { await api.patch(`/users/${id}/role`, { role }); toast.success("Role updated"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this user?")) return;
    try { await api.delete(`/users/${id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const changeCurrency = async (code) => {
    try { await setCurrency(code); toast.success(`Currency set to ${code}`); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Failed to update currency"); }
  };

  return (
    <div>
      <PageHeader title="Users" subtitle="Manage accounts and roles">
        <Btn onClick={() => { setForm(empty); setDialog(true); }} data-testid="add-user-btn"><Plus className="h-4 w-4" /> Add User</Btn>
      </PageHeader>

      <Panel className="mb-6 p-4" data-testid="settings-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Coins className="h-4 w-4 text-blue-600" /> Currency</div>
            <p className="mt-0.5 text-xs text-slate-500">Applies to all prices, maintenance costs and PDF reports. Example: {format(1234.5)}</p>
          </div>
          <div className="w-full sm:max-w-sm">
            <CurrencyCombobox value={currency} onChange={changeCurrency} testId="currency-select" />
          </div>
        </div>
      </Panel>

      <Panel className="mb-6 p-4" data-testid="backup-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Download className="h-4 w-4 text-blue-600" /> Backup &amp; Export <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Admin only</span></div>
            <p className="mt-0.5 text-xs text-slate-500">Download the full application source code, or a complete backup of the database (all collections as JSON).</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="outline" onClick={() => window.open(`${API}/admin/download/source`, "_blank")} data-testid="download-source-btn"><Code2 className="h-4 w-4" /> Source Code</Btn>
            <Btn variant="dark" onClick={() => window.open(`${API}/admin/download/database`, "_blank")} data-testid="download-database-btn"><Database className="h-4 w-4" /> Database Backup</Btn>
          </div>
        </div>
      </Panel>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Created</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50" data-testid={`user-row-${u.id}`}>
                <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-500">{u.auth_provider}</td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} disabled={u.id === user.id}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs" data-testid={`role-select-${u.id}`}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{fmtDate(u.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  {u.id !== user.id && <button onClick={() => remove(u.id)} className="text-slate-400 hover:text-red-600" data-testid={`delete-user-${u.id}`}><Trash2 className="h-4 w-4" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {users.length === 0 && <EmptyState icon={UsersIcon} text="No users" />}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="user-name" />
          <TextInput label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="user-email" />
          <TextInput label="Password" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-password" />
          <SelectInput label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </SelectInput>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setDialog(false)}>Cancel</Btn>
            <Btn onClick={create} data-testid="save-user">Create</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
