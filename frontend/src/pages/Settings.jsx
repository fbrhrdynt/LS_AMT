import {
  BookOpen,
  Coins,
  Code2,
  Database,
  FileDown,
  Globe2,
  ImagePlus,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
  RotateCcw,
  Upload,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  api,
  API,
  formatApiError,
} from "@/lib/api";
import {
  hasLicenseFeature,
  isAdmin,
  isMasterAdmin,
  useAuth,
} from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import CurrencyCombobox from "@/components/CurrencyCombobox";
import {
  PageHeader,
  Btn,
  Panel,
  SelectInput,
} from "@/components/Bits";
import {
  UpdatePanel,
} from "@/components/UpdateNotice";

const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

export default function SettingsPage() {
  const {
    user,
    license: capabilities,
    loadLicense,
  } = useAuth();

  const {
    currency,
    setCurrency,
    format,
  } = useCurrency();

  const [
    timezone,
    setTimezone,
  ] = useState(
    "Asia/Jakarta"
  );

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    license,
    setLicense,
  ] = useState(null);

  const [
    licenseLoading,
    setLicenseLoading,
  ] = useState(false);

  const [
    appLogoConfigured,
    setAppLogoConfigured,
  ] = useState(false);

  const [
    appLogoVersion,
    setAppLogoVersion,
  ] = useState(0);

  const [
    pdfLogoConfigured,
    setPdfLogoConfigured,
  ] = useState(false);

  const [
    logoBusy,
    setLogoBusy,
  ] = useState(false);

  const [
    logoVersion,
    setLogoVersion,
  ] = useState(0);

  const [
    versionHistory,
    setVersionHistory,
  ] = useState(null);

  const [
    versionHistoryLoading,
    setVersionHistoryLoading,
  ] = useState(false);

  const masterAdmin =
    isMasterAdmin(user);

  const settingsAdmin =
    isAdmin(user);

  const canExportCodeDb =
    masterAdmin &&
    hasLicenseFeature(
      capabilities,
      "export_code_db"
    );

  const brandingLicensed =
    hasLicenseFeature(
      capabilities,
      "custom_branding"
    );

  const canCustomBrand =
    settingsAdmin;

  useEffect(() => {
    api
      .get("/settings")
      .then(({ data }) => {
        if (data?.timezone) {
          setTimezone(
            data.timezone
          );
        }

        setAppLogoConfigured(
          Boolean(
            data?.app_logo_configured
          )
        );

        setPdfLogoConfigured(
          Boolean(
            data?.pdf_logo_configured
          )
        );
      })
      .catch(() => {});
  }, []);


  useEffect(() => {
    if (!settingsAdmin) {
      setVersionHistory(null);
      return;
    }

    let cancelled = false;

    setVersionHistoryLoading(
      true
    );

    api
      .get(
        "/product/version-history"
      )
      .then(({ data }) => {
        if (!cancelled) {
          setVersionHistory(
            data
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVersionHistory(
            null
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setVersionHistoryLoading(
            false
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [settingsAdmin]);

  const timezones =
    useMemo(
      () =>
        COMMON_TIMEZONES.includes(
          timezone
        )
          ? COMMON_TIMEZONES
          : [
              timezone,
              ...COMMON_TIMEZONES,
            ],
      [timezone]
    );

  const loadLicenseDetail =
    async () => {
      if (!masterAdmin) {
        return;
      }

      setLicenseLoading(true);

      try {
        const { data } =
          await api.get(
            "/admin/license"
          );

        setLicense(data);

        if (loadLicense) {
          await loadLicense();
        }
      } catch (e) {
        setLicense({
          configured: false,
          valid: false,
          status: "trial",
          plan: "trial",
          message:
            formatApiError(
              e.response?.data
                ?.detail
            ) ||
            "Unable to check LS CRM license",
          features: [],
        });
      } finally {
        setLicenseLoading(
          false
        );
      }
    };

  useEffect(() => {
    if (masterAdmin) {
      loadLicenseDetail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterAdmin]);

  const activateLicense =
    async () => {
      setLicenseLoading(true);

      try {
        const { data } =
          await api.post(
            "/admin/license/activate"
          );

        setLicense(data);

        if (loadLicense) {
          await loadLicense();
        }

        toast.success(
          data?.valid
            ? "License activated"
            : "Activation response received"
        );
      } catch (e) {
        toast.error(
          formatApiError(
            e.response?.data
              ?.detail
          ) ||
            "License activation failed"
        );
      } finally {
        setLicenseLoading(
          false
        );
      }
    };

  const changeCurrency =
    async (code) => {
      try {
        await setCurrency(code);
        toast.success(
          `Currency set to ${code}`
        );
      } catch (e) {
        toast.error(
          formatApiError(
            e.response?.data
              ?.detail
          ) ||
            "Failed to update currency"
        );
      }
    };

  const saveTimezone =
    async () => {
      setSaving(true);

      try {
        const { data } =
          await api.put(
            "/settings/timezone",
            { timezone }
          );

        setTimezone(
          data.timezone ||
            timezone
        );

        toast.success(
          `Timezone set to ${
            data.timezone ||
            timezone
          }`
        );
      } catch (e) {
        toast.error(
          formatApiError(
            e.response?.data
              ?.detail
          ) ||
            "Failed to update timezone"
        );
      } finally {
        setSaving(false);
      }
    };


  const notifyBrandingChanged =
    () => {
      window.dispatchEvent(
        new Event(
          "amt-branding-changed"
        )
      );
    };

  const uploadAppLogo =
    async (file) => {
      if (!file) return;

      if (!brandingLicensed) {
        toast.error(
          "Custom branding requires an eligible AMT license"
        );
        return;
      }

      setLogoBusy(true);

      try {
        const fd =
          new FormData();
        fd.append(
          "file",
          file
        );

        await api.post(
          "/settings/app-logo",
          fd
        );

        setAppLogoConfigured(
          true
        );
        setAppLogoVersion(
          Date.now()
        );
        notifyBrandingChanged();

        toast.success(
          "Application logo updated"
        );
      } catch (e) {
        toast.error(
          formatApiError(
            e.response?.data
              ?.detail
          ) ||
            "Failed to upload application logo"
        );
      } finally {
        setLogoBusy(false);
      }
    };

  const resetAppLogo =
    async () => {
      if (!brandingLicensed) {
        toast.error(
          "Custom branding requires an eligible AMT license"
        );
        return;
      }

      if (
        !window.confirm(
          "Reset the application logo to the original AMT logo?"
        )
      ) {
        return;
      }

      setLogoBusy(true);

      try {
        await api.delete(
          "/settings/app-logo"
        );

        setAppLogoConfigured(
          false
        );
        setAppLogoVersion(
          Date.now()
        );
        notifyBrandingChanged();

        toast.success(
          "Application logo reset to AMT"
        );
      } catch (e) {
        toast.error(
          formatApiError(
            e.response?.data
              ?.detail
          ) ||
            "Failed to reset application logo"
        );
      } finally {
        setLogoBusy(false);
      }
    };

  const uploadPdfLogo =
    async (file) => {
      if (!file) return;

      setLogoBusy(true);

      try {
        const fd =
          new FormData();
        fd.append(
          "file",
          file
        );

        await api.post(
          "/settings/pdf-logo",
          fd
        );

        setPdfLogoConfigured(
          true
        );
        setLogoVersion(
          Date.now()
        );
        toast.success(
          "Company PDF logo updated"
        );
      } catch (e) {
        toast.error(
          formatApiError(
            e.response?.data
              ?.detail
          ) ||
            "Failed to upload company logo"
        );
      } finally {
        setLogoBusy(false);
      }
    };

  const removePdfLogo =
    async () => {
      if (
        !window.confirm(
          "Remove the company PDF logo and return to the AMT logo?"
        )
      ) {
        return;
      }

      setLogoBusy(true);

      try {
        await api.delete(
          "/settings/pdf-logo"
        );

        setPdfLogoConfigured(
          false
        );
        setLogoVersion(
          Date.now()
        );
        toast.success(
          "PDF logo reset to AMT"
        );
      } catch (e) {
        toast.error(
          formatApiError(
            e.response?.data
              ?.detail
          ) ||
            "Failed to remove company logo"
        );
      } finally {
        setLogoBusy(false);
      }
    };

  const detailFeatures =
    license?.features ||
    capabilities?.features ||
    [];

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Application-wide configuration"
      />

      <div className="space-y-6">
        <UpdatePanel />




        <Panel className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Coins className="h-4 w-4 text-blue-600" />
                Currency
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Applies to inventory prices, Purchase maintenance costs and PDF reports.
                Example: {format(1234.5)}
              </p>
            </div>

            <div className="w-full sm:max-w-sm">
              <CurrencyCombobox
                value={currency}
                onChange={
                  changeCurrency
                }
                testId="currency-select"
              />
            </div>
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Globe2 className="h-4 w-4 text-blue-600" />
                Timezone
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Used by maintenance PDF and PDF export timestamps. Database timestamps remain stored in UTC.
              </p>
            </div>

            <div className="flex w-full gap-2 sm:max-w-lg">
              <SelectInput
                value={timezone}
                onChange={(e) =>
                  setTimezone(
                    e.target.value
                  )
                }
                className="min-w-0 flex-1"
                data-testid="timezone-select"
              >
                {timezones.map(
                  (tz) => (
                    <option
                      key={tz}
                      value={tz}
                    >
                      {tz}
                    </option>
                  )
                )}
              </SelectInput>

              <Btn
                onClick={
                  saveTimezone
                }
                disabled={
                  saving
                }
              >
                Save
              </Btn>
            </div>
          </div>
        </Panel>

        {masterAdmin && (
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
                    No valid license runs as Trial with no Feature Flags. Any valid non-Trial plan receives the complete AMT feature set.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Btn
                    variant="outline"
                    onClick={
                      loadLicenseDetail
                    }
                    disabled={
                      licenseLoading
                    }
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${
                        licenseLoading
                          ? "animate-spin"
                          : ""
                      }`}
                    />
                    Refresh
                  </Btn>

                  {license?.configured &&
                    !license?.valid && (
                      <Btn
                        onClick={
                          activateLicense
                        }
                        disabled={
                          licenseLoading
                        }
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
                  <div
                    className={`mt-1 text-sm font-bold ${
                      license?.valid
                        ? "text-emerald-600"
                        : "text-amber-600"
                    }`}
                  >
                    {licenseLoading
                      ? "Checking…"
                      : license?.status ||
                        capabilities?.status ||
                        "trial"}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Plan
                  </div>
                  <div className="mt-1 text-sm font-bold text-slate-900">
                    {license?.plan ||
                      capabilities?.plan ||
                      "trial"}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Expiry
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {license?.expiry ||
                      "—"}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Activations
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {license?.activations ??
                      "—"}
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
                    {license?.license_key ||
                      "Not configured"}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center gap-2 font-semibold text-slate-700">
                    <Server className="h-3.5 w-3.5" />
                    Product
                  </div>
                  <div className="mt-1 font-mono text-slate-500">
                    {license?.product_slug ||
                      "—"}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Feature Flags
                </div>

                {detailFeatures.length >
                0 ? (
                  <div className="flex flex-wrap gap-2">
                    {detailFeatures.map(
                      (feature) => (
                        <span
                          key={
                            feature
                          }
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-semibold text-slate-600"
                        >
                          {
                            feature
                          }
                        </span>
                      )
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    Trial — no Feature Flags enabled.
                  </div>
                )}
              </div>

              {license?.message && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {
                    license.message
                  }
                </div>
              )}
            </div>
          </Panel>
        )}


        {canCustomBrand && (
          <Panel className="p-4">
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  <ImagePlus className="h-4 w-4 text-blue-600" />
                  Application Branding
                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                    Pro
                  </span>
                  <span className="rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                    Master Admin &amp; Admin
                  </span>
                </div>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Replace the AMT logo across the application, sign-in screen and generated PDFs with your company logo. The original AMT logo remains built into the application and can be restored everywhere at any time.
                </p>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Current application logo
                </div>

                <img
                  src={
                    appLogoConfigured
                      ? `${API}/settings/app-logo?v=${appLogoVersion}`
                      : "/amt-mark.png"
                  }
                  alt={
                    appLogoConfigured
                      ? "Company application logo"
                      : "AMT default logo"
                  }
                  className="max-h-20 max-w-[300px] object-contain object-left"
                />

                <div className="mt-2 text-[11px] text-slate-400">
                  {appLogoConfigured
                    ? "Custom company logo is active."
                    : "Original AMT logo is active."}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  <Upload className="h-4 w-4" />
                  {logoBusy
                    ? "Uploading…"
                    : appLogoConfigured
                      ? "Replace Logo"
                      : "Upload Company Logo"}

                  <input
                    type="file"
                    className="hidden"
                    accept=".png,.jpg,.jpeg"
                    disabled={
                      logoBusy
                    }
                    onChange={(e) => {
                      const file =
                        e.target
                          .files?.[0];

                      uploadAppLogo(
                        file
                      );

                      e.target.value =
                        "";
                    }}
                  />
                </label>

                {appLogoConfigured && (
                  <Btn
                    variant="outline"
                    onClick={
                      resetAppLogo
                    }
                    disabled={
                      logoBusy
                    }
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset to AMT Logo
                  </Btn>
                )}
              </div>

              <div className="text-[11px] text-slate-400">
                PNG/JPG only, maximum 2 MB. Reset never deletes the built-in AMT logo.
              </div>
            </div>
          </Panel>
        )}

        {masterAdmin && (
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
                  {canExportCodeDb
                    ? "Download application source code or a complete JSON database backup."
                    : "Unavailable in Trial. A valid non-Trial license is required."}
                </p>
              </div>

              {canExportCodeDb && (
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
              )}
            </div>
          </Panel>
        )}


        {settingsAdmin && (
          <Panel className="p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <BookOpen className="h-4 w-4 text-blue-600" />
                    Version History &amp; Public Product Guide
                    <span className="rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                      Master Admin &amp; Admin
                    </span>
                  </div>

                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Review AMT release notes when needed, or download one always-current public product PDF.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Btn
                    variant="outline"
                    onClick={() => {
                      window.location.href =
                        "/version-history";
                    }}
                  >
                    <BookOpen className="h-4 w-4" />
                    Open Version History
                  </Btn>

                  <Btn
                    variant="outline"
                    onClick={() =>
                      window.open(
                        `${API}/product/public-guide.pdf`,
                        "_blank"
                      )
                    }
                  >
                    <FileDown className="h-4 w-4" />
                    Download Public PDF
                  </Btn>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Installed Version
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
                    {versionHistory?.installed_version || "—"}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Documented Latest
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
                    {versionHistory?.documented_latest || "—"}
                  </div>
                </div>
              </div>

            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
