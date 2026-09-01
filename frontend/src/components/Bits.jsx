import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, children, testId }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" data-testid={testId}>
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Panel({ title, children, className, action, ...rest }) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white", className)} {...rest}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-heading text-sm font-semibold text-slate-900">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Field({ label, value, mono, className }) {
  return (
    <div className={className}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn("mt-0.5 text-sm text-slate-900 break-words", mono && "font-mono")}>{value || "—"}</div>
    </div>
  );
}

export function EmptyState({ icon: Icon, text, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-12 text-slate-400", className)}>
      {Icon && <Icon className="h-8 w-8" />}
      <p className="text-sm">{text}</p>
    </div>
  );
}

export function Btn({ children, variant = "primary", className, ...props }) {
  const styles = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    dark: "bg-slate-900 text-white hover:bg-slate-800",
    outline: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
    ghost: "text-slate-600 hover:bg-slate-100",
  };
  return (
    <button {...props}
      className={cn("inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-60", styles[variant], className)}>
      {children}
    </button>
  );
}

export function TextInput({ label, className, required, ...props }) {
  return (
    <div className={className}>
      {label && <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}{required && <span className="text-red-500"> *</span>}</label>}
      <input {...props}
        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
    </div>
  );
}

export function TextArea({ label, className, ...props }) {
  return (
    <div className={className}>
      {label && <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>}
      <textarea {...props}
        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

export function SelectInput({ label, className, children, required, ...props }) {
  return (
    <div className={className}>
      {label && <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}{required && <span className="text-red-500"> *</span>}</label>}
      <select {...props}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500">
        {children}
      </select>
    </div>
  );
}
