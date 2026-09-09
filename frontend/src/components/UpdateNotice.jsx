import {
  ArrowUpCircle,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  api,
  formatApiError,
} from "@/lib/api";
import {
  hasLicenseFeature,
  isMasterAdmin,
  useAuth,
} from "@/context/AuthContext";
import {
  Btn,
  Panel,
} from "@/components/Bits";

export function useUpdateCheck({
  auto = false,
} = {}) {
  const {
    user,
    license,
  } = useAuth();

  const [update, setUpdate] =
    useState(null);
  const [loading, setLoading] =
    useState(false);
  const [error, setError] =
    useState("");

  const allowed =
    isMasterAdmin(user) &&
    hasLicenseFeature(
      license,
      "update_version"
    );

  const check =
    useCallback(async () => {
      if (!allowed) {
        setUpdate(null);
        return null;
      }

      setLoading(true);
      setError("");

      try {
        const { data } =
          await api.get(
            "/admin/update/check"
          );
        setUpdate(data);
        return data;
      } catch (e) {
        setError(
          formatApiError(
            e.response?.data?.detail
          ) ||
            "Unable to check for updates"
        );
        return null;
      } finally {
        setLoading(false);
      }
    }, [allowed]);

  useEffect(() => {
    if (auto && allowed) {
      check();
    }
  }, [auto, allowed, check]);

  return {
    allowed,
    update,
    loading,
    error,
    check,
  };
}

export function UpdateBanner() {
  const {
    allowed,
    update,
  } = useUpdateCheck({
    auto: true,
  });

  if (
    !allowed ||
    !update?.update_available
  ) {
    return null;
  }

  return (
    <div className="no-print border-b border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950/40 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div>
            <div className="text-sm font-semibold text-blue-900 dark:text-blue-100">
              AMT {update.latest_version} is available
            </div>
            <div className="mt-0.5 text-xs text-blue-700 dark:text-blue-300">
              Current version: {update.current_version}
              {update.title ? ` · ${update.title}` : ""}
            </div>
          </div>
        </div>

        <a
          href="/settings"
          className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300"
        >
          View Update
        </a>
      </div>
    </div>
  );
}

export function UpdatePanel() {
  const {
    allowed,
    update,
    loading,
    error,
    check,
  } = useUpdateCheck({
    auto: true,
  });

  if (!allowed) {
    return null;
  }

  return (
    <Panel className="p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ArrowUpCircle className="h-4 w-4 text-blue-600" />
              Version &amp; Updates
              <span className="rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                Master Admin only
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Checks signed AMT releases published through LS CRM.
            </p>
          </div>

          <Btn
            variant="outline"
            onClick={check}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Check Update
          </Btn>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Info
            label="Current Version"
            value={update?.current_version || "—"}
          />
          <Info
            label="Latest Version"
            value={
              update?.latest_version ||
              update?.current_version ||
              "—"
            }
          />
          <Info
            label="Channel"
            value={update?.channel || "stable"}
          />
        </div>

        {update?.update_available ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
            <div className="font-semibold text-blue-900 dark:text-blue-100">
              Update available: {update.latest_version}
            </div>

            {update.title && (
              <div className="mt-1 text-sm text-blue-800 dark:text-blue-200">
                {update.title}
              </div>
            )}

            {update.release_notes && (
              <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-5 text-blue-700 dark:text-blue-300">
                {update.release_notes}
              </pre>
            )}

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-blue-700 dark:text-blue-300">
              {update.mandatory && <span>Mandatory</span>}
              {update.has_database_migration && (
                <span>Database migration</span>
              )}
              {update.requires_restart && (
                <span>Restart required</span>
              )}
            </div>

            <div className="mt-3 text-[11px] text-blue-700 dark:text-blue-300">
              Package metadata is ready for the secure updater.
            </div>
          </div>
        ) : update && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            AMT is up to date.
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Info({
  label,
  value,
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
        {value}
      </div>
    </div>
  );
}
