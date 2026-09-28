import {
  Copy,
  ExternalLink,
  Power,
  QrCode,
  RefreshCcw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  API,
  api,
  formatApiError,
} from "@/lib/api";
import {
  Btn,
  Panel,
} from "@/components/Bits";


export default function InventoryPublicAccess({
  categories = [],
}) {
  const [links, setLinks] =
    useState([]);
  const [busyId, setBusyId] =
    useState("");
  const [expandedId, setExpandedId] =
    useState("");

  const categoryKey = useMemo(
    () =>
      [...categories]
        .sort()
        .join("|"),
    [categories]
  );

  const sync = useCallback(
    async () => {
      try {
        const { data } =
          await api.post(
            "/inventory-category-public-access/sync"
          );

        setLinks(
          Array.isArray(data)
            ? data
            : []
        );
      } catch (error) {
        toast.error(
          formatApiError(
            error.response?.data
              ?.detail
          ) ||
            "Could not load category QR links"
        );
      }
    },
    []
  );

  useEffect(() => {
    sync();
  }, [
    sync,
    categoryKey,
  ]);

  const updateLink = (
    updated
  ) => {
    setLinks(
      (current) =>
        current.map(
          (item) =>
            item.id ===
            updated.id
              ? updated
              : item
        )
    );
  };

  const action = async (
    link,
    suffix,
    message
  ) => {
    setBusyId(link.id);

    try {
      const { data } =
        await api.post(
          `/inventory-category-public-access/${link.id}/${suffix}`
        );

      updateLink(data);
      setExpandedId(
        data.id
      );
      toast.success(message);
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data
            ?.detail
        )
      );
    } finally {
      setBusyId("");
    }
  };

  const copy = async (
    link
  ) => {
    try {
      await navigator.clipboard.writeText(
        link.public_url
      );
      toast.success(
        "Public link copied"
      );
    } catch {
      toast.error(
        "Could not copy the link"
      );
    }
  };

  const reset = async (
    link
  ) => {
    if (
      !window.confirm(
        `Reset QR link for ${link.category}? ` +
          "The previous printed QR will stop working."
      )
    ) {
      return;
    }

    await action(
      link,
      "reset",
      `${link.category} QR link reset`
    );
  };

  return (
    <Panel
      title="Inventory QR / Public Link by Category"
      className="mb-5"
    >
      <div className="p-4">
        <p className="text-xs leading-5 text-slate-500">
          Each Inventory category has its own cabinet QR. New categories receive a QR automatically.
        </p>

        {links.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            No Inventory category available yet.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {links.map(
              (link) => {
                const expanded =
                  expandedId ===
                  link.id;
                const busy =
                  busyId ===
                  link.id;

                return (
                  <div
                    key={link.id}
                    className="rounded-lg border border-slate-200 bg-white"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {link.category}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {link.item_count ?? 0} item(s)
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            link.enabled
                              ? "border-green-200 bg-green-50 text-green-700"
                              : "border-red-200 bg-red-50 text-red-700"
                          }`}
                        >
                          {link.enabled
                            ? "Active"
                            : "Disabled"}
                        </span>

                        <Btn
                          variant="outline"
                          onClick={() =>
                            setExpandedId(
                              expanded
                                ? ""
                                : link.id
                            )
                          }
                        >
                          <QrCode className="h-4 w-4" />
                          {expanded
                            ? "Hide QR / Public Link"
                            : "View QR / Public Link"}
                        </Btn>
                      </div>
                    </div>

                    {expanded && (
                      <div className="grid gap-4 border-t border-slate-100 p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <img
                            src={`${API}/inventory-category-public-access/${link.id}/qr.png?v=${
                              link.updated_at || ""
                            }`}
                            alt={`${link.category} Inventory QR`}
                            className="mx-auto aspect-square w-full max-w-[190px]"
                          />
                        </div>

                        <div className="min-w-0">
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Public URL
                          </label>

                          <div className="mt-1 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                            {link.public_url}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <Btn
                              variant="outline"
                              onClick={() =>
                                copy(link)
                              }
                            >
                              <Copy className="h-4 w-4" />
                              Copy Link
                            </Btn>

                            <Btn
                              variant="outline"
                              onClick={() =>
                                window.open(
                                  link.public_url,
                                  "_blank",
                                  "noopener,noreferrer"
                                )
                              }
                            >
                              <ExternalLink className="h-4 w-4" />
                              Open Public View
                            </Btn>

                            <Btn
                              variant="outline"
                              onClick={() =>
                                window.open(
                                  `${API}/inventory-category-public-access/${link.id}/qr-label.png?download=true`,
                                  "_blank",
                                  "noopener,noreferrer"
                                )
                              }
                            >
                              <QrCode className="h-4 w-4" />
                              Download Cabinet Label
                            </Btn>

                            <Btn
                              variant="outline"
                              onClick={() =>
                                reset(link)
                              }
                              disabled={busy}
                            >
                              <RefreshCcw className="h-4 w-4" />
                              Reset Link
                            </Btn>

                            {link.enabled ? (
                              <Btn
                                variant="danger"
                                onClick={() =>
                                  action(
                                    link,
                                    "disable",
                                    `${link.category} public link disabled`
                                  )
                                }
                                disabled={busy}
                              >
                                <Power className="h-4 w-4" />
                                Disable
                              </Btn>
                            ) : (
                              <Btn
                                onClick={() =>
                                  action(
                                    link,
                                    "enable",
                                    `${link.category} public link enabled`
                                  )
                                }
                                disabled={busy}
                              >
                                <Power className="h-4 w-4" />
                                Enable
                              </Btn>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
