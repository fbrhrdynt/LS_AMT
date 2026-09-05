import { Coins, Code2, Database, Download, Globe2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, API, formatApiError } from "@/lib/api";
import { useCurrency } from "@/context/CurrencyContext";
import CurrencyCombobox from "@/components/CurrencyCombobox";
import { PageHeader, Btn, Panel, SelectInput } from "@/components/Bits";

const COMMON_TIMEZONES = [
  "UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore",
  "Asia/Kuala_Lumpur", "Asia/Bangkok", "Asia/Dubai", "Asia/Kolkata", "Asia/Tokyo",
  "Australia/Perth", "Australia/Sydney", "Europe/London", "Europe/Paris",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
];

export default function SettingsPage() {
  const { currency, setCurrency, format } = useCurrency();
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/settings").then(({ data }) => data?.timezone && setTimezone(data.timezone)).catch(() => {});
  }, []);

  const timezones = useMemo(() => COMMON_TIMEZONES.includes(timezone)
    ? COMMON_TIMEZONES : [timezone, ...COMMON_TIMEZONES], [timezone]);

  const changeCurrency = async (code) => {
    try { await setCurrency(code); toast.success(`Currency set to ${code}`); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Failed to update currency"); }
  };

  const saveTimezone = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/settings/timezone", { timezone });
      setTimezone(data.timezone || timezone);
      toast.success(`Timezone set to ${data.timezone || timezone}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Failed to update timezone");
    } finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Application-wide configuration" />
      <div className="space-y-6">
        <Panel className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Coins className="h-4 w-4 text-blue-600" /> Currency</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Applies to inventory prices, Purchase maintenance costs and PDF reports. Example: {format(1234.5)}</p>
            </div>
            <div className="w-full sm:max-w-sm"><CurrencyCombobox value={currency} onChange={changeCurrency} testId="currency-select" /></div>
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Globe2 className="h-4 w-4 text-blue-600" /> Timezone</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Used by maintenance PDF and PDF export timestamps. Database timestamps remain stored in UTC.</p>
            </div>
            <div className="flex w-full gap-2 sm:max-w-lg">
              <SelectInput value={timezone} onChange={(e) => setTimezone(e.target.value)} className="min-w-0 flex-1" data-testid="timezone-select">
                {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </SelectInput>
              <Btn onClick={saveTimezone} disabled={saving}>Save</Btn>
            </div>
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Download className="h-4 w-4 text-blue-600" /> Backup &amp; Export <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Admin only</span></div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Download application source code or a complete JSON database backup.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn variant="outline" onClick={() => window.open(`${API}/admin/download/source`, "_blank")}><Code2 className="h-4 w-4" /> Source Code</Btn>
              <Btn variant="dark" onClick={() => window.open(`${API}/admin/download/database`, "_blank")}><Database className="h-4 w-4" /> Database Backup</Btn>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
