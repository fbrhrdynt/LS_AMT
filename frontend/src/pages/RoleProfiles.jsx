import {
  ArrowLeft,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
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
  api,
  formatApiError,
} from "@/lib/api";
import {
  Btn,
  EmptyState,
  PageHeader,
  Panel,
  SelectInput,
  TextInput,
} from "@/components/Bits";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";


const MENU_OPTIONS = [
  ["dash", "Dashboard"],
  ["eq", "Equipment"],
  ["mnt", "Maintenance"],
  ["cal", "Calibration"],
  ["inv", "Parts & Materials"],
  ["cli", "Clients"],
  ["job", "Jobs"],
  ["rep", "Reports"],
  ["imp", "Excel Import"],
  ["aud", "Audit Trail"],
  ["usr", "Users"],
  ["set", "Settings"],
];

const ALL_MENU_KEYS =
  MENU_OPTIONS.map(
    ([key]) => key
  );

const BASE_ROLES = [
  ["admin", "Admin"],
  ["supervisor", "Supervisor"],
  ["technician", "Technician"],
  ["viewer", "Viewer"],
];

const EMPTY = {
  name: "",
  base_role: "technician",
  menu_access: [
    ...ALL_MENU_KEYS,
  ],
};


export default function RoleProfiles() {
  const navigate = useNavigate();

  const [
    profiles,
    setProfiles,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    dialog,
    setDialog,
  ] = useState(false);

  const [
    editing,
    setEditing,
  ] = useState(null);

  const [
    form,
    setForm,
  ] = useState(EMPTY);

  const load = async () => {
    setLoading(true);

    try {
      const { data } =
        await api.get(
          "/role-profiles"
        );

      setProfiles(
        data || []
      );
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data
            ?.detail
        ) ||
          "Failed to load custom roles"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY,
      menu_access: [
        ...ALL_MENU_KEYS,
      ],
    });
    setDialog(true);
  };

  const openEdit =
    (profile) => {
      setEditing(profile);
      setForm({
        name:
          profile.name || "",
        base_role:
          profile.base_role ||
          "technician",
        menu_access:
          Array.isArray(
            profile.menu_access
          )
            ? [
                ...profile.menu_access,
              ]
            : [],
      });
      setDialog(true);
    };

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      base_role:
        form.base_role,
      menu_access:
        form.menu_access,
    };

    if (
      payload.name.length < 2
    ) {
      toast.error(
        "Role name is required"
      );
      return;
    }

    try {
      if (editing) {
        await api.put(
          `/role-profiles/${editing.id}`,
          payload
        );
        toast.success(
          "Custom role updated"
        );
      } else {
        await api.post(
          "/role-profiles",
          payload
        );
        toast.success(
          "Custom role created"
        );
      }

      setDialog(false);
      await load();
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data
            ?.detail
        ) ||
          "Could not save custom role"
      );
    }
  };

  const remove =
    async (profile) => {
      if (
        !window.confirm(
          `Delete custom role "${profile.name}"?`
        )
      ) {
        return;
      }

      try {
        await api.delete(
          `/role-profiles/${profile.id}`
        );
        toast.success(
          "Custom role deleted"
        );
        await load();
      } catch (error) {
        toast.error(
          formatApiError(
            error.response?.data
              ?.detail
          ) ||
            "Could not delete custom role"
        );
      }
    };

  return (
    <div>
      <PageHeader
        title="Custom Roles"
        subtitle="Create reusable account roles for your operation"
      >
        <Btn
          variant="outline"
          onClick={() =>
            navigate("/users")
          }
        >
          <ArrowLeft className="h-4 w-4" />
          Users
        </Btn>

        <Btn
          onClick={
            openCreate
          }
        >
          <Plus className="h-4 w-4" />
          Add Custom Role
        </Btn>
      </PageHeader>

      <Panel className="mb-4 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />

          <div>
            <div className="text-sm font-semibold text-slate-900">
              Master Admin role templates
            </div>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              A custom role combines a role name, a built-in permission level, and menu access. For example, Service Planner can use Supervisor permissions with planning menus, while Storekeeper can use Technician permissions with Parts &amp; Materials access.
            </p>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Custom Master Admin roles are intentionally not allowed. The protected Master Admin authority remains a built-in role.
            </p>
          </div>
        </div>
      </Panel>

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Loading custom roles…
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          text="No custom roles yet"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {profiles.map(
            (profile) => (
              <Panel
                key={profile.id}
                className="p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-bold text-slate-900">
                      {profile.name}
                    </div>

                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
                        Base: {profile.base_role}
                      </span>

                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                        {profile.assigned_count || 0} user(s)
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        openEdit(
                          profile
                        )
                      }
                      className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
                      title="Edit custom role"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        remove(
                          profile
                        )
                      }
                      className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete custom role"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Menu Access
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {(profile.menu_access || []).map(
                      (key) => (
                        <span
                          key={key}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600"
                        >
                          {menuLabel(
                            key
                          )}
                        </span>
                      )
                    )}

                    {(profile.menu_access || []).length === 0 && (
                      <span className="text-xs text-slate-400">
                        No menus assigned
                      </span>
                    )}
                  </div>
                </div>
              </Panel>
            )
          )}
        </div>
      )}

      <Dialog
        open={dialog}
        onOpenChange={
          setDialog
        }
      >
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Edit Custom Role"
                : "Add Custom Role"}
            </DialogTitle>
          </DialogHeader>

          <TextInput
            label="Role Name"
            value={
              form.name
            }
            placeholder="e.g. Service Planner"
            onChange={(event) =>
              setForm({
                ...form,
                name:
                  event.target
                    .value,
              })
            }
          />

          <SelectInput
            label="Base Permission Level"
            value={
              form.base_role
            }
            onChange={(event) =>
              setForm({
                ...form,
                base_role:
                  event.target
                    .value,
              })
            }
          >
            {BASE_ROLES.map(
              ([value, label]) => (
                <option
                  key={value}
                  value={value}
                >
                  {label}
                </option>
              )
            )}
          </SelectInput>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Menu Access
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Every account assigned to this role will use these menus.
                </div>
              </div>

              <div className="flex gap-2 text-[11px]">
                <button
                  type="button"
                  className="font-semibold text-blue-600"
                  onClick={() =>
                    setForm({
                      ...form,
                      menu_access: [
                        ...ALL_MENU_KEYS,
                      ],
                    })
                  }
                >
                  Select all
                </button>

                <button
                  type="button"
                  className="font-semibold text-slate-500"
                  onClick={() =>
                    setForm({
                      ...form,
                      menu_access: [],
                    })
                  }
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
              {MENU_OPTIONS.map(
                ([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={
                        form.menu_access.includes(
                          key
                        )
                      }
                      onChange={() => {
                        const selected =
                          new Set(
                            form.menu_access
                          );

                        if (
                          selected.has(
                            key
                          )
                        ) {
                          selected.delete(
                            key
                          );
                        } else {
                          selected.add(
                            key
                          );
                        }

                        setForm({
                          ...form,
                          menu_access:
                            ALL_MENU_KEYS.filter(
                              (item) =>
                                selected.has(
                                  item
                                )
                            ),
                        });
                      }}
                    />

                    {label}
                  </label>
                )
              )}
            </div>
          </div>

          <DialogFooter>
            <Btn
              variant="outline"
              onClick={() =>
                setDialog(false)
              }
            >
              Cancel
            </Btn>

            <Btn
              onClick={save}
            >
              {editing
                ? "Save Changes"
                : "Create Role"}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function menuLabel(key) {
  return (
    MENU_OPTIONS.find(
      ([value]) =>
        value === key
    )?.[1] || key
  );
}
