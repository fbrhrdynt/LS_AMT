import { useRef, useState } from "react";
import {
  ExternalLink,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { api, API, formatApiError } from "@/lib/api";
import { Btn, SelectInput } from "@/components/Bits";


const DOCUMENT_TYPES = [
  "Before Photo",
  "After Photo",
  "Function Test",
  "Lifting Inspection",
  "Inspection Report",
  "Failure Evidence",
  "Calibration Certificate",
  "Test Certificate",
  "Certificate",
  "Other Document",
];

const ACCEPTED_FILES =
  ".jpg,.jpeg,.png,.webp,.gif,.pdf,.csv,.txt,.xlsx,.doc,.docx";


function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 KB";
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}


export default function MaintenanceDocuments({
  maintenance,
  equipmentId,
  documents = [],
  canEditUser = false,
  onChanged,
}) {
  const fileRef = useRef(null);
  const [docType, setDocType] = useState("Before Photo");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !maintenance?.id || !equipmentId) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      fd.append("equipment_id", equipmentId);
      fd.append("maintenance_id", maintenance.id);

      await api.post("/files/upload", fd);
      toast.success(
        `${docType} uploaded to ${maintenance.mnt_no}`
      );
      await onChanged?.();
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (file) => {
    const ok = window.confirm(
      `Remove "${file.original_filename}" from ${maintenance.mnt_no}?`
    );
    if (!ok) return;

    setDeletingId(file.id);
    try {
      await api.delete(`/files/${file.id}`);
      toast.success("Document removed");
      await onChanged?.();
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Documents & Attachments
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
              {documents.length}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Photos, function tests, inspections, certificates, and other
            records for this maintenance.
          </div>
        </div>

        {canEditUser && (
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
            <SelectInput
              label="Document Type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="min-w-0 sm:w-48"
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </SelectInput>

            <Btn
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="shrink-0"
              data-testid={`upload-maintenance-doc-${maintenance.id}`}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Upload Document"}
            </Btn>

            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept={ACCEPTED_FILES}
              onChange={upload}
              data-testid={`maintenance-doc-file-${maintenance.id}`}
            />
          </div>
        )}
      </div>

      {documents.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {documents.map((file) => (
            <div
              key={file.id}
              className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-3"
              data-testid={`maintenance-doc-${file.id}`}
            >
              <FileText className="h-7 w-7 shrink-0 text-slate-400" />

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">
                  {file.original_filename}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  <span>{file.doc_type || "Document"}</span>
                  <span>·</span>
                  <span>{formatSize(file.size)}</span>
                </div>
              </div>

              <a
                href={`${API}/files/${file.id}/download`}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-blue-600"
                title="Open file"
                aria-label={`Open ${file.original_filename}`}
              >
                <ExternalLink className="h-4 w-4" />
              </a>

              {canEditUser && (
                <button
                  type="button"
                  onClick={() => remove(file)}
                  disabled={deletingId === file.id}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  title="Remove document"
                  aria-label={`Remove ${file.original_filename}`}
                >
                  {deletingId === file.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-slate-200 px-4 py-4 text-center text-xs text-slate-400">
          No documents uploaded for this maintenance.
        </div>
      )}
    </div>
  );
}
