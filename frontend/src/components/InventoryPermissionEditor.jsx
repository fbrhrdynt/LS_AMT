const OPS = [
  ["view", "View"],
  ["add", "Add"],
  ["edit", "Edit / Adjust"],
  ["delete", "Delete"],
  ["public", "Public QR"],
];

export const INVENTORY_PERMISSION_KEYS =
  OPS.map(([key]) => key);

export default function InventoryPermissionEditor({
  value = [],
  onChange,
  disabled = false,
}) {
  const selected = new Set(
    Array.isArray(value)
      ? value
      : []
  );

  const toggle = (key) => {
    if (disabled) return;

    const next = new Set(selected);

    if (key === "view") {
      if (next.has("view")) {
        next.clear();
      } else {
        next.add("view");
      }
    } else if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      next.add("view");
    }

    onChange(
      INVENTORY_PERMISSION_KEYS.filter(
        (item) =>
          next.has(item)
      )
    );
  };

  return (
    <div>
      <div className="mb-2">
        <div className="text-xs font-semibold text-slate-700">
          Inventory Permissions
        </div>
        <div className="text-[11px] text-slate-400">
          Fine-grained permissions for Inventory. Public QR controls category cabinet links.
        </div>
      </div>

      <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-5">
        {OPS.map(
          ([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded bg-white px-3 py-2 text-xs font-medium text-slate-700"
            >
              <input
                type="checkbox"
                checked={selected.has(
                  key
                )}
                disabled={disabled}
                onChange={() =>
                  toggle(key)
                }
              />
              {label}
            </label>
          )
        )}
      </div>
    </div>
  );
}
