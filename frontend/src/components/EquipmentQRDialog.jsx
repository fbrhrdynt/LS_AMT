import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { api, API, formatApiError } from "@/lib/api";
import { Btn } from "@/components/Bits";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";


export default function EquipmentQRDialog({
  open,
  onOpenChange,
  equipment,
  canReset = false,
}) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);

  useEffect(() => {
    if (!open || !equipment?.id) {
      setInfo(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const { data } = await api.get(
          `/equipment/${equipment.id}/public-link`
        );
        if (!cancelled) setInfo(data);
      } catch (e) {
        if (!cancelled) {
          toast.error(formatApiError(e.response?.data?.detail));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, equipment?.id]);

  const qrSrc = useMemo(() => {
    if (!equipment?.id) return "";
    return `${API}/equipment/${equipment.id}/qr.png?v=${imageVersion}`;
  }, [equipment?.id, imageVersion]);

  const downloadUrl = useMemo(() => {
    if (!equipment?.id) return "";
    return `${API}/equipment/${equipment.id}/qr.png?download=true&v=${imageVersion}`;
  }, [equipment?.id, imageVersion]);

  const resetLink = async () => {
    if (!equipment?.id) return;

    const ok = window.confirm(
      "Reset Public Link? The current QR code and every previously printed copy will stop working immediately."
    );
    if (!ok) return;

    setResetting(true);
    try {
      const { data } = await api.post(
        `/equipment/${equipment.id}/public-link/reset`
      );
      setInfo((prev) => ({
        ...(prev || {}),
        public_url: data.public_url,
      }));
      setImageVersion((v) => v + 1);
      toast.success("Public link reset. Old QR code is now invalid.");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setResetting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Equipment QR
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Preparing equipment QR…
          </div>
        )}

        {!loading && info && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="font-heading text-lg font-bold text-slate-900">
                {equipment?.name || equipment?.category || equipment?.sap_no}
              </div>
              <div className="font-mono text-xs text-slate-500">
                SAP {equipment?.sap_no || "—"}
              </div>
            </div>

            <div className="mx-auto flex max-w-[300px] items-center justify-center rounded-xl border border-slate-200 bg-white p-4">
              <img
                src={qrSrc}
                alt={`QR code for ${equipment?.sap_no || "equipment"}`}
                className="h-auto w-full max-w-[260px]"
              />
            </div>

            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Public Equipment Passport
              </div>
              <div className="mt-1 break-all font-mono text-xs text-slate-600">
                {info.public_url}
              </div>
              <div className="mt-2 text-xs leading-5 text-slate-500">
                No login required. View-only equipment information and closed
                maintenance history. Resetting the link invalidates this QR.
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <a
                href={downloadUrl}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Download className="h-4 w-4" />
                Download QR
              </a>

              <a
                href={info.public_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" />
                Open Public View
              </a>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {canReset && info && (
              <Btn
                variant="danger"
                onClick={resetLink}
                disabled={resetting}
              >
                {resetting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reset Public Link
              </Btn>
            )}
          </div>
          <Btn variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
