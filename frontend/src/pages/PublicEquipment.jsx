import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CalendarDays,
  ExternalLink,
  FileImage,
  FileText,
  HardHat,
  Loader2,
  MapPin,
  Paperclip,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { API, api } from "@/lib/api";


function fmtDate(value) {
  if (!value) return "—";
  const text = String(value).slice(0, 10);
  const parts = text.split("-");
  if (parts.length !== 3) return text;

  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return text;

  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    }).format(
      new Date(Date.UTC(year, month - 1, day))
    );
  } catch {
    return text;
  }
}


function valueOrDash(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }
  return String(value);
}


function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";

  if (value < 1024 * 1024) {
    return `${Math.max(
      1,
      Math.round(value / 1024)
    )} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}


function isImageDocument(file) {
  return String(file?.content_type || "").startsWith(
    "image/"
  );
}


function StatusPill({ value }) {
  const text = valueOrDash(value);
  const good =
    text.toLowerCase() === "operational";

  return (
    <span
      className={[
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
        good
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-700",
      ].join(" ")}
    >
      {text}
    </span>
  );
}


function InfoItem({
  label,
  value,
  mono = false,
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div
        className={[
          "mt-1 break-words text-sm font-medium text-slate-800",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {valueOrDash(value)}
      </div>
    </div>
  );
}


function PublicDocuments({
  files,
  token,
}) {
  if (!files?.length) return null;

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex items-center gap-2">
        <Paperclip className="h-3.5 w-3.5 text-slate-400" />
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Documents
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
          {files.length}
        </span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {files.map((file) => {
          const Icon = isImageDocument(file)
            ? FileImage
            : FileText;

          const url =
            `${API}/public/equipment/` +
            `${encodeURIComponent(token)}/files/` +
            `${encodeURIComponent(file.id)}`;

          return (
            <a
              key={file.id}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-3 transition-colors hover:bg-slate-50"
            >
              <Icon className="h-7 w-7 shrink-0 text-slate-400" />

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">
                  {file.original_filename}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  <span>
                    {file.doc_type || "Document"}
                  </span>
                  {formatSize(file.size) && (
                    <>
                      <span>·</span>
                      <span>
                        {formatSize(file.size)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
            </a>
          );
        })}
      </div>
    </div>
  );
}


export default function PublicEquipment() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [state, setState] =
    useState("loading");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState("loading");

      try {
        const { data } = await api.get(
          `/public/equipment/${encodeURIComponent(
            token
          )}`
        );

        if (!cancelled) {
          setData(data);
          setState("ready");
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setState("not-found");
        }
      }
    };

    if (token) load();
    else setState("not-found");

    return () => {
      cancelled = true;
    };
  }, [token]);

  const equipment =
    data?.equipment || {};
  const maintenance =
    data?.maintenance || [];
  const documents =
    data?.documents || [];

  const documentsByMaintenance = useMemo(
    () =>
      documents.reduce((acc, file) => {
        if (!file?.maintenance_id) {
          return acc;
        }

        if (!acc[file.maintenance_id]) {
          acc[file.maintenance_id] = [];
        }

        acc[file.maintenance_id].push(file);
        return acc;
      }, {}),
    [documents]
  );

  const title = useMemo(
    () =>
      equipment.name ||
      equipment.category ||
      equipment.sap_no ||
      "Equipment",
    [equipment]
  );

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto flex max-w-lg items-center justify-center rounded-xl border border-slate-200 bg-white p-10 text-sm text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading equipment passport…
        </div>
      </div>
    );
  }

  if (state === "not-found") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center">
          <HardHat className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="mt-4 font-heading text-xl font-bold text-slate-900">
            Equipment not found
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            This public equipment link is invalid,
            expired, or has been reset.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-left">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-heading text-lg font-extrabold tracking-tight text-slate-900">
                AMT
              </div>
              <div className="text-[11px] font-medium text-slate-400">
                Asset Maintenance Tracker
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5" />
              Public · View only
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                  Equipment Passport
                </div>

                <h1 className="mt-1 break-words font-heading text-2xl font-bold text-slate-900">
                  {title}
                </h1>

                <div className="mt-1 font-mono text-sm text-slate-500">
                  SAP{" "}
                  {valueOrDash(
                    equipment.sap_no
                  )}
                </div>
              </div>

              <StatusPill
                value={
                  equipment.operational_status
                }
              />
            </div>
          </div>

          <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
            <InfoItem
              label="Serial / Mfg No."
              value={equipment.mfg_no}
              mono
            />
            <InfoItem
              label="Category"
              value={equipment.category}
            />
            <InfoItem
              label="Manufacturer"
              value={
                equipment.manufacturer
              }
            />
            <InfoItem
              label="Date of Purchase"
              value={fmtDate(
                equipment.date_of_purchase
              )}
              mono
            />
            <InfoItem
              label="Physical Condition"
              value={
                equipment.physical_condition
              }
            />

            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Current Location
              </div>

              <div className="mt-1 flex min-w-0 items-start gap-1.5 text-sm font-medium text-slate-800">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <span className="break-words">
                  {valueOrDash(
                    equipment.current_location ||
                      equipment.placement
                  )}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div>
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-blue-600" />
                <h2 className="font-heading text-base font-bold text-slate-900">
                  Maintenance History
                </h2>
              </div>

              <div className="mt-1 text-xs text-slate-400">
                Closed maintenance records and
                attachments only
              </div>
            </div>

            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-600">
              {maintenance.length}
            </span>
          </div>

          {maintenance.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              No closed maintenance records.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {maintenance.map((m) => {
                const mDocuments =
                  documentsByMaintenance[m.id] ||
                  [];

                return (
                  <article
                    key={m.id}
                    className="p-5 sm:p-6"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-blue-600">
                            {m.mnt_no}
                          </span>

                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            Closed
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {fmtDate(
                              m.maintenance_date
                            )}
                            {m.date_closed
                              ? ` → ${fmtDate(
                                  m.date_closed
                                )}`
                              : ""}
                          </span>

                          {m.type_of_maintenance && (
                            <span>
                              {
                                m.type_of_maintenance
                              }
                            </span>
                          )}

                          {m.maintenance_category && (
                            <span>
                              {
                                m.maintenance_category
                              }
                            </span>
                          )}
                        </div>

                        {m.problem_damage && (
                          <div className="mt-3">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              Problem / Damage
                            </div>

                            <p className="mt-1 break-words text-sm leading-6 text-slate-700">
                              {m.problem_damage}
                            </p>
                          </div>
                        )}

                        {m.final_condition && (
                          <div className="mt-3">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              Final Condition
                            </div>

                            <p className="mt-1 break-words text-sm text-slate-700">
                              {m.final_condition}
                            </p>
                          </div>
                        )}
                      </div>

                      <a
                        href={`${API}/public/equipment/${encodeURIComponent(
                          token
                        )}/maintenance/${encodeURIComponent(
                          m.id
                        )}/report.pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <FileText className="h-4 w-4" />
                        PDF
                      </a>
                    </div>

                    <PublicDocuments
                      files={mDocuments}
                      token={token}
                    />
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="pb-5 text-center text-xs leading-5 text-slate-400">
          Public equipment record · View only
          <br />
          AMT — Asset Maintenance Tracker by
          LogiSource Digital
        </footer>
      </main>
    </div>
  );
}
