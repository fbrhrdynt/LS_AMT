import {
  ArrowLeft,
  BookOpen,
  Download,
  Loader2,
} from "lucide-react";
import {
  useEffect,
  useState,
} from "react";
import {
  useNavigate,
} from "react-router-dom";
import { toast } from "sonner";

import {
  API,
  api,
  formatApiError,
} from "@/lib/api";
import {
  Btn,
  PageHeader,
  Panel,
} from "@/components/Bits";


export default function VersionHistory() {
  const navigate = useNavigate();

  const [
    data,
    setData,
  ] = useState(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .get(
        "/product/version-history"
      )
      .then(({ data: result }) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            formatApiError(
              error.response?.data
                ?.detail
            ) ||
              "Failed to load version history"
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Version History"
        subtitle="AMT release log and public product documentation"
      >
        <Btn
          variant="outline"
          onClick={() =>
            navigate(
              "/settings"
            )
          }
        >
          <ArrowLeft className="h-4 w-4" />
          Settings
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
          <Download className="h-4 w-4" />
          Download Public PDF
        </Btn>
      </PageHeader>

      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
          <BookOpen className="h-4 w-4 text-blue-600" />
          AMT Release Log
          <span className="rounded bg-violet-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
            Master Admin &amp; Admin
          </span>
        </div>

        <p className="mt-1 text-xs leading-5 text-slate-500">
          Product-facing history for signed AMT releases. Revoked releases remain visible for auditability and should not be installed.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Info
            label="Installed Version"
            value={
              data?.installed_version ||
              "—"
            }
          />

          <Info
            label="Documented Latest"
            value={
              data?.documented_latest ||
              "—"
            }
          />
        </div>
      </Panel>

      {loading ? (
        <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-12 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading version history…
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.versions || []).map(
            (release) => {
              const latest =
                release.version ===
                data?.documented_latest;

              return (
                <Panel
                  key={release.version}
                  className="p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-bold text-slate-900">
                      {release.version}
                    </span>

                    <StatusBadge
                      status={
                        release.status
                      }
                    />

                    {latest && (
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
                        Latest
                      </span>
                    )}
                  </div>

                  <div className="mt-2 text-base font-semibold text-slate-900">
                    {release.title}
                  </div>

                  <div className="mt-1 text-sm leading-6 text-slate-500">
                    {release.summary}
                  </div>

                  {release.changes?.length >
                    0 && (
                    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-600">
                      {release.changes.map(
                        (change) => (
                          <li key={change}>
                            {change}
                          </li>
                        )
                      )}
                    </ul>
                  )}
                </Panel>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}


function StatusBadge({
  status,
}) {
  const value = String(
    status || "unknown"
  ).toLowerCase();

  const className =
    value === "revoked"
      ? "bg-red-100 text-red-700"
      : value === "stable"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-slate-100 text-slate-600";

  return (
    <span
      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${className}`}
    >
      {value}
    </span>
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
