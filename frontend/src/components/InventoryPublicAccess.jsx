import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Power,
  QrCode,
  RefreshCcw,
  Search,
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
  const [links, setLinks] = useState([]);
  const [busyId, setBusyId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");

  const categoryKey = useMemo(
    () => [...categories].sort().join("|"),
    [categories]
  );

  const sync = useCallback(async () => {
    try {
      const { data } = await api.post(
        "/inventory-category-public-access/sync"
      );
      setLinks(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail) ||
          "Could not load category QR links"
      );
    }
  }, []);

  useEffect(() => {
    sync();
  }, [sync, categoryKey]);

  const selected = useMemo(
    () => links.find((item) => item.id === selectedId) || null,
    [links, selectedId]
  );

  const filteredLinks = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return links;

    return links.filter((item) =>
      String(item.category || "")
        .toLowerCase()
        .includes(term)
    );
  }, [links, search]);

  const updateLink = (updated) => {
    setLinks((current) =>
      current.map((item) =>
        item.id === updated.id ? updated : item
      )
    );
  };

  const action = async (link, suffix, message) => {
    setBusyId(link.id);

    try {
      const { data } = await api.post(
        `/inventory-category-public-access/${link.id}/${suffix}`
      );
      updateLink(data);
      setSelectedId(data.id);
      toast.success(message);
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
    } finally {
      setBusyId("");
    }
  };

  const copy = async (link) => {
    try {
      await navigator.clipboard.writeText(link.public_url);
      toast.success("Public PDF link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const reset = async (link) => {
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs leading-5 text-slate-500">
              One QR per Inventory category.
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {links.length} category link(s)
            </p>
          </div>

          <Btn
            variant="outline"
            onClick={() => {
              setExpanded((value) => !value);
              if (expanded) setSelectedId("");
            }}
            data-testid="toggle-category-public-links"
          >
            <QrCode className="h-4 w-4" />
            {expanded
              ? "Hide QR Public Link Category"
              : "View QR Public Link Category"}
          </Btn>
        </div>

        {expanded && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            {links.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                No Inventory category available yet.
              </div>
            ) : (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search category..."
                    className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="max-h-[320px] overflow-y-auto rounded-md border border-slate-200">
                  {filteredLinks.map((link) => {
                    const active = selectedId === link.id;

                    return (
                      <button
                        key={link.id}
                        type="button"
                        onClick={() =>
                          setSelectedId(active ? "" : link.id)
                        }
                        className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 ${
                          active
                            ? "bg-blue-50"
                            : "bg-white hover:bg-slate-50"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {link.category}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {link.item_count ?? 0} item(s)
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              link.enabled
                                ? "border-green-200 bg-green-50 text-green-700"
                                : "border-red-200 bg-red-50 text-red-700"
                            }`}
                          >
                            {link.enabled ? "Active" : "Disabled"}
                          </span>

                          {active ? (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}

                  {filteredLinks.length === 0 && (
                    <div className="p-6 text-center text-sm text-slate-400">
                      No category matches your search.
                    </div>
                  )}
                </div>

                {selected && (
                  <div className="mt-4 grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[210px_minmax(0,1fr)]">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-center text-xs font-semibold text-slate-700">
                        {selected.category}
                      </div>
                      <img
                        src={`${API}/inventory-category-public-access/${selected.id}/qr.png?v=${selected.updated_at || ""}`}
                        alt={`${selected.category} Inventory QR`}
                        className="mx-auto aspect-square w-full max-w-[180px]"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Public PDF Link
                      </label>

                      <div className="mt-1 break-all rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700">
                        {selected.public_url}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Btn
                          variant="outline"
                          onClick={() => copy(selected)}
                        >
                          <Copy className="h-4 w-4" />
                          Copy Link
                        </Btn>

                        <Btn
                          variant="outline"
                          onClick={() =>
                            window.open(
                              selected.public_url,
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open Public Link
                        </Btn>

                        <Btn
                          variant="outline"
                          onClick={() =>
                            window.open(
                              `${API}/inventory-category-public-access/${selected.id}/qr-label.png?download=true`,
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
                          onClick={() => reset(selected)}
                          disabled={busyId === selected.id}
                        >
                          <RefreshCcw className="h-4 w-4" />
                          Reset Link
                        </Btn>

                        {selected.enabled ? (
                          <Btn
                            variant="danger"
                            onClick={() =>
                              action(
                                selected,
                                "disable",
                                `${selected.category} public link disabled`
                              )
                            }
                            disabled={busyId === selected.id}
                          >
                            <Power className="h-4 w-4" />
                            Disable
                          </Btn>
                        ) : (
                          <Btn
                            onClick={() =>
                              action(
                                selected,
                                "enable",
                                `${selected.category} public link enabled`
                              )
                            }
                            disabled={busyId === selected.id}
                          >
                            <Power className="h-4 w-4" />
                            Enable
                          </Btn>
                        )}
                      </div>

                      <div className="mt-3 text-[11px] leading-4 text-slate-400">
                        QR scan and Open Public Link deliver the branded PDF for this category directly.
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
