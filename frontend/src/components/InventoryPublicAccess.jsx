import {
  Copy,
  ExternalLink,
  Link2,
  Power,
  QrCode,
  RefreshCcw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
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


export default function InventoryPublicAccess() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(
        "/inventory-public-access"
      );
      setState(data);
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        ) ||
          "Could not load Inventory public access"
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const action = async (
    path,
    message,
    openAfter = false
  ) => {
    setBusy(true);

    try {
      const { data } = await api.post(path);
      setState(data);

      if (openAfter) {
        setExpanded(true);
      }

      toast.success(message);
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!state?.public_url) return;

    try {
      await navigator.clipboard.writeText(
        state.public_url
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

  const reset = async () => {
    if (
      !window.confirm(
        "Reset the public Inventory link? " +
          "Any QR label already printed will immediately stop working."
      )
    ) {
      return;
    }

    await action(
      "/inventory-public-access/reset",
      "Public Inventory link reset",
      true
    );
  };

  const disable = async () => {
    if (
      !window.confirm(
        "Disable the public Inventory link? " +
          "Scanned QR codes will stop working until re-enabled."
      )
    ) {
      return;
    }

    await action(
      "/inventory-public-access/disable",
      "Public Inventory link disabled"
    );
  };

  return (
    <Panel
      title="Inventory QR / Public Link"
      className="mb-5"
    >
      <div className="p-4">
        <p className="text-xs leading-5 text-slate-500">
          Manage the QR code and public Inventory link used on the physical cabinet.
        </p>

        {!state?.generated ? (
          <div className="mt-4">
            <Btn
              onClick={() =>
                action(
                  "/inventory-public-access/generate",
                  "Public Inventory link generated",
                  true
                )
              }
              disabled={busy}
              data-testid="generate-inventory-public-link"
            >
              <QrCode className="h-4 w-4" />
              Generate QR / Public Link
            </Btn>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Btn
                variant="outline"
                onClick={() =>
                  setExpanded(
                    (value) => !value
                  )
                }
                data-testid="view-inventory-public-link"
              >
                <QrCode className="h-4 w-4" />
                {expanded
                  ? "Hide QR / Public Link"
                  : "View QR / Public Link"}
              </Btn>

              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  state.enabled
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {state.enabled
                  ? "Active"
                  : "Disabled"}
              </span>
            </div>

            {expanded && (
              <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <img
                    src={`${API}/inventory-public-access/qr.png?v=${
                      state.updated_at || ""
                    }`}
                    alt="Inventory public QR"
                    className="mx-auto aspect-square w-full max-w-[190px]"
                  />
                </div>

                <div className="min-w-0">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Public URL
                  </label>

                  <div className="mt-1 flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <Link2 className="h-4 w-4 shrink-0 text-slate-400" />

                    <code className="min-w-0 flex-1 break-all text-xs text-slate-700">
                      {state.public_url}
                    </code>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Btn
                      variant="outline"
                      onClick={copy}
                    >
                      <Copy className="h-4 w-4" />
                      Copy Link
                    </Btn>

                    <Btn
                      variant="outline"
                      onClick={() =>
                        window.open(
                          state.public_url,
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
                          `${API}/inventory-public-access/qr-label.png?download=true`,
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
                      onClick={reset}
                      disabled={busy}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Reset Link
                    </Btn>

                    {state.enabled ? (
                      <Btn
                        variant="danger"
                        onClick={disable}
                        disabled={busy}
                      >
                        <Power className="h-4 w-4" />
                        Disable Public Link
                      </Btn>
                    ) : (
                      <Btn
                        onClick={() =>
                          action(
                            "/inventory-public-access/enable",
                            "Public Inventory link enabled",
                            true
                          )
                        }
                        disabled={busy}
                      >
                        <Power className="h-4 w-4" />
                        Enable Public Link
                      </Btn>
                    )}
                  </div>

                  <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    Reset Link revokes the previous QR immediately.
                    Print a new cabinet label after resetting.
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
