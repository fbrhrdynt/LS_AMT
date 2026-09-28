import {
  FileSpreadsheet,
  FileText,
  Package,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useParams,
} from "react-router-dom";

import BrandLogo from "@/components/BrandLogo";
import {
  API,
  api,
} from "@/lib/api";


const STOCK_OPTIONS = [
  ["", "All Stock Status"],
  ["low", "Low Stock / At Minimum"],
  ["out", "Out of Stock"],
  ["healthy", "Healthy / Above Minimum"],
];

const SORT_OPTIONS = [
  ["category_asc", "Category A-Z"],
  ["item_code_asc", "Item Code A-Z"],
  ["item_name_asc", "Item Name A-Z"],
  ["stock_asc", "Lowest Stock First"],
];


export default function PublicInventory() {
  const { token } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [location, setLocation] = useState("");
  const [sort, setSort] = useState("category_asc");

  const query = useMemo(() => {
    const params = new URLSearchParams();

    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    if (type) params.set("type", type);
    if (stockStatus) {
      params.set("stock_status", stockStatus);
    }
    if (location.trim()) {
      params.set(
        "storage_location",
        location.trim()
      );
    }

    params.set("sort", sort);
    return params.toString();
  }, [
    q,
    category,
    type,
    stockStatus,
    location,
    sort,
  ]);

  const load = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const { data: result } = await api.get(
        `/public/inventory/${encodeURIComponent(
          token
        )}?${query}`
      );
      setData(result);
    } catch (requestError) {
      setData(null);

      if (
        requestError.response?.status === 429
      ) {
        setError(
          "Too many requests. Please wait a moment and try again."
        );
      } else {
        setError(
          "This Inventory public link is unavailable or has been revoked."
        );
      }
    } finally {
      setLoading(false);
    }
  }, [token, query]);

  useEffect(() => {
    const timer = window.setTimeout(
      load,
      250
    );

    return () =>
      window.clearTimeout(timer);
  }, [load]);

  const exportReport = (format) => {
    window.open(
      `${API}/public/inventory/${encodeURIComponent(
        token
      )}/export.${format}?${query}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const items = data?.items || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <meta
        name="robots"
        content="noindex,nofollow,noarchive"
      />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <BrandLogo
            fallback="/amt-mark-tagline.png"
            alt="AMT - Asset Maintenance Tracker"
            className="h-auto w-44 object-contain object-left sm:w-52"
          />

          <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
            Public · Read Only
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <Package className="h-6 w-6 text-blue-600" />

            <h1 className="font-heading text-2xl font-bold text-slate-900 sm:text-3xl">
              Inventory
            </h1>
          </div>

          <p className="mt-1 text-sm text-slate-500">
            Current cabinet inventory.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-white p-8 text-center">
            <h2 className="font-semibold text-red-700">
              Public Inventory Unavailable
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              {error}
            </p>
          </div>
        ) : (
          <>
            <section className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="relative">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Search
                  </span>

                  <Search className="absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" />

                  <input
                    value={q}
                    onChange={(event) =>
                      setQ(event.target.value)
                    }
                    placeholder="Code, item, part number..."
                    className="mt-1 w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <FilterSelect
                  label="Category"
                  value={category}
                  onChange={setCategory}
                >
                  <option value="">
                    All Categories
                  </option>

                  {(data?.categories || []).map(
                    (value) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {value}
                      </option>
                    )
                  )}
                </FilterSelect>

                <FilterSelect
                  label="Type"
                  value={type}
                  onChange={setType}
                >
                  <option value="">
                    All Types
                  </option>

                  {(data?.types || []).map(
                    (value) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {value}
                      </option>
                    )
                  )}
                </FilterSelect>

                <FilterSelect
                  label="Stock Status"
                  value={stockStatus}
                  onChange={setStockStatus}
                >
                  {STOCK_OPTIONS.map(
                    ([value, label]) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {label}
                      </option>
                    )
                  )}
                </FilterSelect>

                <label>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Storage Location
                  </span>

                  <input
                    value={location}
                    onChange={(event) =>
                      setLocation(event.target.value)
                    }
                    placeholder="e.g. Rack A"
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <FilterSelect
                  label="Sort"
                  value={sort}
                  onChange={setSort}
                >
                  {SORT_OPTIONS.map(
                    ([value, label]) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {label}
                      </option>
                    )
                  )}
                </FilterSelect>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-500">
                  {loading
                    ? "Loading inventory..."
                    : `${data?.total || 0} item(s)`}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      exportReport("xlsx")
                    }
                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Excel
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      exportReport("pdf")
                    }
                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FileText className="h-4 w-4" />
                    PDF
                  </button>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">
                        Code
                      </th>
                      <th className="px-4 py-3">
                        Item
                      </th>
                      <th className="px-4 py-3">
                        Category
                      </th>
                      <th className="px-4 py-3">
                        Type
                      </th>
                      <th className="px-4 py-3">
                        Part No.
                      </th>
                      <th className="px-4 py-3 text-right">
                        Stock
                      </th>
                      <th className="px-4 py-3 text-right">
                        Min
                      </th>
                      <th className="px-4 py-3">
                        Status
                      </th>
                      <th className="px-4 py-3">
                        Storage Location
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr
                        key={`${item.item_code}-${item.item_name}`}
                      >
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                          {item.item_code}
                        </td>

                        <td className="px-4 py-3 text-slate-900">
                          {item.item_name}
                        </td>

                        <td className="px-4 py-3 text-slate-600">
                          {item.category || "Uncategorized"}
                        </td>

                        <td className="px-4 py-3 text-slate-600">
                          {item.type}
                        </td>

                        <td className="px-4 py-3 font-mono text-slate-500">
                          {item.part_number || "—"}
                        </td>

                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                          {item.stock} {item.unit}
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-slate-500">
                          {item.min_stock}
                        </td>

                        <td className="px-4 py-3">
                          <StockStatus
                            value={item.stock_status}
                          />
                        </td>

                        <td className="px-4 py-3 text-slate-600">
                          {item.storage_location || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!loading &&
                items.length === 0 && (
                  <div className="p-10 text-center text-sm text-slate-400">
                    No Inventory items match the selected filters.
                  </div>
                )}
            </section>

          </>
        )}

        <footer className="mt-8 border-t border-slate-200 pt-5 text-center text-xs text-slate-400">
          Powered by AMT (Asset Maintenance Tracker) - LogiSource Digital
        </footer>
      </main>
    </div>
  );
}


function FilterSelect({
  label,
  value,
  onChange,
  children,
}) {
  return (
    <label>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
      >
        {children}
      </select>
    </label>
  );
}


function StockStatus({
  value,
}) {
  const className =
    value === "Out of Stock"
      ? "border-red-200 bg-red-50 text-red-700"
      : value === "Low Stock"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-green-200 bg-green-50 text-green-700";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {value}
    </span>
  );
}
