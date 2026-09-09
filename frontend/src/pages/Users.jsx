import {
  KeyRound,
  Plus,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  api,
  formatApiError,
} from "@/lib/api";
import {
  isMasterAdmin,
  useAuth,
} from "@/context/AuthContext";
import {
  Btn,
  EmptyState,
  PageHeader,
  SelectInput,
  TextInput,
} from "@/components/Bits";
import { fmtDate } from "@/lib/helpers";
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
  MENU_OPTIONS.map(([key]) => key);

const STANDARD_ROLES = [
  "admin",
  "supervisor",
  "technician",
  "viewer",
];

const empty = {
  email: "",
  name: "",
  password: "",
  role: "technician",
  menu_access: [...ALL_MENU_KEYS],
};


function MenuCheckboxes({
  value,
  onChange,
  disabled = false,
}) {
  const selected = new Set(
    Array.isArray(value)
      ? value
      : ALL_MENU_KEYS
  );

  const toggle = (key) => {
    const next = new Set(selected);

    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    onChange(
      ALL_MENU_KEYS.filter((item) =>
        next.has(item)
      )
    );
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-700">
            Menu Access
          </div>
          <div className="text-[11px] text-slate-400">
            Choose which menus appear and can be opened by this user.
          </div>
        </div>

        {!disabled && (
          <div className="flex gap-2 text-[11px]">
            <button
              type="button"
              className="font-semibold text-blue-600"
              onClick={() =>
                onChange([...ALL_MENU_KEYS])
              }
            >
              Select all
            </button>
            <button
              type="button"
              className="font-semibold text-slate-500"
              onClick={() =>
                onChange([])
              }
            >
              Clear
            </button>
          </div>
        )}
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
                  disabled ||
                  selected.has(key)
                }
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

      {disabled && (
        <div className="mt-1 text-[11px] text-slate-400">
          Master Admin always has access to all menus.
        </div>
      )}
    </div>
  );
}


export default function UsersPage() {
  const { user } = useAuth();

  const [users, setUsers] =
    useState([]);
  const [dialog, setDialog] =
    useState(false);
  const [form, setForm] =
    useState(empty);

  const [accessTarget, setAccessTarget] =
    useState(null);
  const [accessValue, setAccessValue] =
    useState([]);

  const roleOptions = useMemo(
    () =>
      isMasterAdmin(user)
        ? [
            "master_admin",
            ...STANDARD_ROLES,
          ]
        : STANDARD_ROLES,
    [user]
  );

  const load = async () => {
    try {
      const { data } =
        await api.get("/users");
      setUsers(data);
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        ) ||
          "Failed to load users"
      );
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm({
      ...empty,
      menu_access: [
        ...ALL_MENU_KEYS,
      ],
    });
    setDialog(true);
  };

  const create = async () => {
    if (
      !form.email ||
      !form.password
    ) {
      toast.error(
        "Email and password required"
      );
      return;
    }

    try {
      await api.post(
        "/users",
        form
      );

      toast.success(
        "User created"
      );
      setDialog(false);
      setForm({
        ...empty,
        menu_access: [
          ...ALL_MENU_KEYS,
        ],
      });
      load();
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        )
      );
    }
  };

  const changeRole = async (
    id,
    role
  ) => {
    try {
      await api.patch(
        `/users/${id}/role`,
        { role }
      );
      toast.success(
        "Role updated"
      );
      load();
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        )
      );
    }
  };

  const openAccess = (target) => {
    setAccessTarget(target);
    setAccessValue(
      Array.isArray(
        target.menu_access
      )
        ? target.menu_access
        : [...ALL_MENU_KEYS]
    );
  };

  const saveAccess = async () => {
    if (!accessTarget) {
      return;
    }

    try {
      await api.patch(
        `/users/${accessTarget.id}/access`,
        {
          menu_access:
            accessValue,
        }
      );

      toast.success(
        "Menu access updated"
      );
      setAccessTarget(null);
      load();
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        )
      );
    }
  };

  const remove = async (id) => {
    if (
      !window.confirm(
        "Delete this user?"
      )
    ) {
      return;
    }

    try {
      await api.delete(
        `/users/${id}`
      );
      toast.success("Deleted");
      load();
    } catch (error) {
      toast.error(
        formatApiError(
          error.response?.data?.detail
        )
      );
    }
  };

  const masterSelected =
    form.role === "master_admin";

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage accounts, roles, and menu access"
      >
        <Btn
          onClick={openCreate}
          data-testid="add-user-btn"
        >
          <Plus className="h-4 w-4" />
          Add User
        </Btn>
      </PageHeader>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  Name
                </th>
                <th className="px-4 py-3">
                  Email
                </th>
                <th className="px-4 py-3">
                  Provider
                </th>
                <th className="px-4 py-3">
                  Role
                </th>
                <th className="px-4 py-3">
                  Menu Access
                </th>
                <th className="px-4 py-3">
                  Created
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const access =
                  Array.isArray(
                    u.menu_access
                  )
                    ? u.menu_access
                    : ALL_MENU_KEYS;

                return (
                  <tr
                    key={u.id}
                    className="hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {u.name}
                    </td>

                    <td className="px-4 py-3 text-slate-600">
                      {u.email}
                    </td>

                    <td className="px-4 py-3 text-slate-500">
                      {u.auth_provider}
                    </td>

                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(event) =>
                          changeRole(
                            u.id,
                            event.target.value
                          )
                        }
                        disabled={
                          u.id === user.id
                        }
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                      >
                        {roleOptions.map(
                          (role) => (
                            <option
                              key={role}
                              value={role}
                            >
                              {role}
                            </option>
                          )
                        )}
                      </select>
                    </td>

                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          openAccess(u)
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {u.role ===
                        "master_admin"
                          ? "All menus"
                          : `${access.length} menu(s)`}
                      </button>
                    </td>

                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {fmtDate(
                        u.created_at
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {u.id !==
                        user.id && (
                        <button
                          type="button"
                          onClick={() =>
                            remove(
                              u.id
                            )
                          }
                          className="text-slate-400 hover:text-red-600"
                          title="Delete user"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {users.length === 0 && (
          <EmptyState
            icon={UsersIcon}
            text="No visible users"
          />
        )}
      </div>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
      >
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Add User
            </DialogTitle>
          </DialogHeader>

          <TextInput
            label="Name"
            value={form.name}
            onChange={(event) =>
              setForm({
                ...form,
                name:
                  event.target.value,
              })
            }
          />

          <TextInput
            label="Email"
            type="email"
            required
            value={form.email}
            onChange={(event) =>
              setForm({
                ...form,
                email:
                  event.target.value,
              })
            }
          />

          <TextInput
            label="Password"
            type="password"
            required
            value={form.password}
            onChange={(event) =>
              setForm({
                ...form,
                password:
                  event.target.value,
              })
            }
          />

          <SelectInput
            label="Role"
            value={form.role}
            onChange={(event) => {
              const role =
                event.target.value;

              setForm({
                ...form,
                role,
                menu_access:
                  role ===
                  "master_admin"
                    ? [
                        ...ALL_MENU_KEYS,
                      ]
                    : form.menu_access,
              });
            }}
          >
            {roleOptions.map(
              (role) => (
                <option
                  key={role}
                  value={role}
                >
                  {role}
                </option>
              )
            )}
          </SelectInput>

          <MenuCheckboxes
            value={form.menu_access}
            disabled={
              masterSelected
            }
            onChange={(
              menu_access
            ) =>
              setForm({
                ...form,
                menu_access,
              })
            }
          />

          <DialogFooter>
            <Btn
              variant="outline"
              onClick={() =>
                setDialog(false)
              }
            >
              Cancel
            </Btn>
            <Btn onClick={create}>
              Create
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(accessTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setAccessTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Menu Access —{" "}
              {accessTarget?.name}
            </DialogTitle>
          </DialogHeader>

          <MenuCheckboxes
            value={accessValue}
            disabled={
              accessTarget?.role ===
              "master_admin"
            }
            onChange={
              setAccessValue
            }
          />

          <DialogFooter>
            <Btn
              variant="outline"
              onClick={() =>
                setAccessTarget(
                  null
                )
              }
            >
              Cancel
            </Btn>
            <Btn
              onClick={saveAccess}
              disabled={
                accessTarget?.role ===
                "master_admin"
              }
            >
              Save Access
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
