import {
  Coins,
  Code2,
  Database,
  Globe2,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, API, formatApiError } from "@/lib/api";
import { useCurrency } from "@/context/CurrencyContext";
import {
  isMasterAdmin,
  useAuth,
} from "@/context/AuthContext";
import CurrencyCombobox from "@/components/CurrencyCombobox";
import { PageHeader, Btn, Panel, SelectInput } from "@/components/Bits";

const COMMON_TIMEZONES = [
  "UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore",
  "Asia/Kuala_Lumpur", "Asia/Bangkok", "Asia/Dubai", "Asia/Kolkata", "Asia/Tokyo",
  "Australia/Perth", "Australia/Sydney", "Europe/London", "Europe/Paris",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
];

export default function SettingsPage() {
  const { user } = useAuth();
  const { currency, setCurrency, format } = useCurrency();
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [saving, setSaving] = useState(false);
  const [license, setLicense] = useState(null);
  const [licenseLoading, setLicenseLoading] =
    useState(false);
  const masterAdmin = isMasterAdmin(user);

  useEffect(() => {
    api.get("/settings").then(({ data }) => data?.timezone && setTimezone(data.timezone)).catch(() => {});
  }, []);

  const timezones = useMemo(() => COMMON_TIMEZONES.includes(timezone)
    ? COMMON_TIMEZONES : [timezone, ...COMMON_TIMEZONES], [timezone]);

  const loadLicense = async () => {
    if (!masterAdmin) return;

    setLicenseLoading(true);
    try {
      const { data } = await api.get("/admin/license");
      setLicense(data);
    } catch (e) {
      setLicense({
        configured: false,
        valid: false,
        status: "Unavailable",
        message:
          formatApiError(e.response?.data?.detail) ||
          "Unable to check LS CRM license",
        features: [],
      });
    } finally {
      setLicenseLoading(false);
    }
  };

  useEffect(() => {
    if (masterAdmin) {
      loadLicense();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterAdmin]);

  const activateLicense = async () => {
    setLicenseLoading(true);
    try {
      const { data } = await api.post(
        "/admin/license/activate"
      );
      setLicense(data);
      toast.success(
        data?.valid
          ? "License activated"
          : "Activation response received"
      );
    } catch (e) {
      toast.error(
        formatApiError(e.response?.data?.detail) ||
          "License activation failed"
      );
    } finally {
      setLicenseLoading(false);
    }
  };

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

        {masterAdmin && (
          <>
            <Panel className="p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <ShieldCheck className="h-4 w-4 text-blue-600" />
                      License
                      <span className="rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                        Master Admin only
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Live license information is verified server-to-server against LS CRM.
                      The full license key is never sent to the browser.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Btn
                      variant="outline"
                      onClick={loadLicense}
                      disabled={licenseLoading}
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${
                          licenseLoading ? "animate-spin" : ""
                        }`}
                      />
                      Refresh
                    </Btn>

                    {license?.configured && !license?.valid && (
                      <Btn
                        onClick={activateLicense}
                        disabled={licenseLoading}
                      >
                        <KeyRound className="h-4 w-4" />
                        Activate
                      </Btn>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Status
                    </div>
                    <div className={`mt-1 text-sm font-bold ${
                      license?.valid
                        ? "text-emerald-600"
                        : "text-amber-600"
                    }`}>
                      {licenseLoading
                        ? "Checking…"
                        : license?.status || "Not configured"}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Plan
                    </div>
                    <div className="mt-1 text-sm font-bold text-slate-900">
                      {license?.plan || "—"}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Expiry
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {license?.expiry || "—"}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Activations
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {license?.activations ?? "—"}
                      {license?.activation_limit != null
                        ? ` / ${license.activation_limit}`
                        : ""}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                      <KeyRound className="h-3.5 w-3.5" />
                      License Key
                    </div>
                    <div className="mt-1 font-mono text-slate-500">
                      {license?.license_key || "Not configured"}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                      <Server className="h-3.5 w-3.5" />
                      Product
                    </div>
                    <div className="mt-1 font-mono text-slate-500">
                      {license?.product_slug || "—"}
                    </div>
                  </div>
                </div>

                {license?.features?.length > 0 && (
                  <div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Feature Flags
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {license.features.map((feature) => (
                        <span
                          key={feature}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-semibold text-slate-600"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {license?.message && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {license.message}
                  </div>
                )}
              </div>
            </Panel>

            <Panel className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <Code2 className="h-4 w-4 text-blue-600" />
                    Export Code &amp; Database
                    <span className="rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                      Master Admin only
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Download application source code or a complete JSON database backup.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Btn
                    variant="outline"
                    onClick={() =>
                      window.open(
                        `${API}/admin/download/source`,
                        "_blank"
                      )
                    }
                  >
                    <Code2 className="h-4 w-4" />
                    Export Code
                  </Btn>

                  <Btn
                    variant="dark"
                    onClick={() =>
                      window.open(
                        `${API}/admin/download/database`,
                        "_blank"
                      )
                    }
                  >
                    <Database className="h-4 w-4" />
                    Database
                  </Btn>
                </div>
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
