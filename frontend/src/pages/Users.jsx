import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  ShieldPlus,
  Trash2,
  Users as UsersIcon,
  XCircle,
} from "lucide-react";
import {
  useEffect,
  useMemo,
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
  canManageUsers,
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

const ALL_MENU_KEYS = MENU_OPTIONS.map(([key]) => key);

const ROLE_OPTIONS = {
  master_admin: [
    "master_admin",
    "admin",
    "supervisor",
    "technician",
    "viewer",
  ],
  admin: [
    "admin",
    "supervisor",
    "technician",
    "viewer",
  ],
  supervisor: [
    "technician",
    "viewer",
  ],
};

const empty = {
  email: "",
  name: "",
  password: "",
  confirm_password: "",
  role: "technician",
  role_profile_id: "",
  menu_access: [...ALL_MENU_KEYS],
};

function isFebro(target) {
  return String(target?.name || "")
    .toUpperCase()
    .includes("FEBRO HERDYANTO");
}

function availableRoles(actor) {
  return ROLE_OPTIONS[actor?.role] || [];
}

function canManageTarget(actor, target) {
  if (!actor || !target) return false;
  if (isMasterAdmin(actor)) return true;
  if (actor.role === "admin") {
    return target.role !== "master_admin";
  }
  if (actor.role === "supervisor") {
    return ["technician", "viewer"].includes(target.role);
  }
  return false;
}

function MenuCheckboxes({
  value,
  onChange,
  allowedKeys = ALL_MENU_KEYS,
  disabled = false,
  disabledMessage = (
    "Master Admin always has access to all menus."
  ),
}) {
  const allowed = new Set(
    allowedKeys
  );

  const visibleOptions =
    MENU_OPTIONS.filter(
      ([key]) =>
        allowed.has(key)
    );

  const selected = new Set(
    Array.isArray(value)
      ? value.filter((key) =>
          allowed.has(key)
        )
      : allowedKeys
  );

  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);

    onChange(
      allowedKeys.filter(
        (item) =>
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
              onClick={() => onChange([...allowedKeys])}
            >
              Select all
            </button>
            <button
              type="button"
              className="font-semibold text-slate-500"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
        {visibleOptions.map(([key, label]) => (
          <label
            key={key}
            className="flex items-center gap-2 rounded bg-white px-3 py-2 text-sm text-slate-700"
          >
            <input
              type="checkbox"
              checked={disabled || selected.has(key)}
              disabled={disabled}
              onChange={() => toggle(key)}
            />
            {label}
          </label>
        ))}
      </div>

      {disabled && (
        <div className="mt-1 text-[11px] text-slate-400">
          {disabledMessage}
        </div>
      )}
    </div>
  );
}

export default function UsersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);

  const [
    roleProfiles,
    setRoleProfiles,
  ] = useState([]);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(empty);
  const [showPassword, setShowPassword] =
    useState(false);
  const [accessTarget, setAccessTarget] = useState(null);
  const [accessValue, setAccessValue] = useState([]);

  const createRoles = useMemo(
    () => availableRoles(user),
    [user]
  );

  const defaultRole = createRoles.includes("technician")
    ? "technician"
    : createRoles[0] || "viewer";

  const delegableMenuKeys = useMemo(() => {
    if (isMasterAdmin(user)) {
      return [...ALL_MENU_KEYS];
    }

    if (!Array.isArray(user?.menu_access)) {
      return [...ALL_MENU_KEYS];
    }

    return ALL_MENU_KEYS.filter(
      (key) =>
        user.menu_access.includes(
          key
        )
    );
  }, [user]);

  const compatibleProfiles =
    useMemo(
      () =>
        roleProfiles.filter(
          (profile) =>
            createRoles.includes(
              profile.base_role
            ) &&
            (
              profile.menu_access ||
              []
            ).every(
              (key) =>
                delegableMenuKeys.includes(
                  key
                )
            )
        ),
      [
        roleProfiles,
        createRoles,
        delegableMenuKeys,
      ]
    );

  const load = async () => {
    try {
      const [
        usersResponse,
        rolesResponse,
      ] = await Promise.all([
        api.get("/users"),
        api.get("/role-profiles"),
      ]);

      setUsers(
        usersResponse.data || []
      );
      setRoleProfiles(
        rolesResponse.data || []
      );
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail) ||
          "Failed to load users"
      );
    }
  };

  useEffect(() => {
    if (canManageUsers(user)) load();
  }, [user]);

  const openCreate = () => {
    setForm({
      ...empty,
      role: defaultRole,
      role_profile_id: "",
      menu_access: [
        ...delegableMenuKeys,
      ],
    });
    setShowPassword(false);
    setDialog(true);
  };

  const create = async () => {
    if (!form.email || !form.password) {
      toast.error("Email and password required");
      return;
    }

    if (form.password.length < 12) {
      toast.error(
        "Password must contain at least 12 characters"
      );
      return;
    }

    if (
      form.password !==
      form.confirm_password
    ) {
      toast.error(
        "Password confirmation does not match"
      );
      return;
    }

    const selectedProfile =
      form.role_profile_id
        ? compatibleProfiles.find(
            (profile) =>
              profile.id ===
              form.role_profile_id
          )
        : null;

    if (
      form.role_profile_id &&
      !selectedProfile
    ) {
      toast.error(
        "You cannot create this custom role"
      );
      return;
    }

    if (
      !form.role_profile_id &&
      !createRoles.includes(
        form.role
      )
    ) {
      toast.error(
        "You cannot create this role"
      );
      return;
    }

    try {
      const {
        confirm_password,
        ...payload
      } = form;

      await api.post(
        "/users",
        payload
      );
      toast.success("User created");
      setDialog(false);
      setForm({
        ...empty,
        role: defaultRole,
        role_profile_id: "",
        menu_access: [
          ...delegableMenuKeys,
        ],
      });
      load();
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
    }
  };

  const changeRole = async (target, role) => {
    if (!canManageTarget(user, target)) return;

    try {
      await api.patch(`/users/${target.id}/role`, { role });
      toast.success("Role updated");
      load();
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
    }
  };

  const changeRoleProfile =
    async (
      target,
      profileId
    ) => {
      if (
        !canManageTarget(
          user,
          target
        )
      ) {
        return;
      }

      try {
        if (profileId) {
          await api.patch(
            `/users/${target.id}/role-profile`,
            {
              role_profile_id:
                profileId,
            }
          );
        } else {
          await api.patch(
            `/users/${target.id}/role`,
            {
              role:
                target.role,
            }
          );
        }

        toast.success(
          "Role updated"
        );
        load();
      } catch (error) {
        toast.error(
          formatApiError(
            error.response?.data
              ?.detail
          )
        );
      }
    };

  const openAccess = (target) => {
    if (!canManageTarget(user, target)) return;

    setAccessTarget(target);
    const currentAccess =
      Array.isArray(
        target.menu_access
      )
        ? target.menu_access
        : [
            ...ALL_MENU_KEYS,
          ];

    setAccessValue(
      delegableMenuKeys.filter(
        (key) =>
          currentAccess.includes(
            key
          )
      )
    );
  };

  const saveAccess = async () => {
    if (!accessTarget) return;

    try {
      await api.patch(`/users/${accessTarget.id}/access`, {
        menu_access: accessValue,
      });
      toast.success("Menu access updated");
      setAccessTarget(null);
      load();
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
    }
  };

  const remove = async (target) => {
    if (!canManageTarget(user, target) || isFebro(target)) {
      return;
    }

    if (!window.confirm(`Delete user ${target.name}?`)) {
      return;
    }

    try {
      await api.delete(`/users/${target.id}`);
      toast.success("Deleted");
      load();
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail)
      );
    }
  };

  const masterSelected =
    form.role === "master_admin" &&
    !form.role_profile_id;

  const profileSelected =
    Boolean(
      form.role_profile_id
    );

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Role hierarchy and menu access"
      >
        {isMasterAdmin(user) && (
          <Btn
            variant="outline"
            onClick={() =>
              navigate("/roles")
            }
          >
            <ShieldPlus className="h-4 w-4" />
            Manage Roles
          </Btn>
        )}

        <Btn onClick={openCreate} data-testid="add-user-btn">
          <Plus className="h-4 w-4" />
          Add User
        </Btn>
      </PageHeader>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <div className="font-semibold text-slate-800">
          User hierarchy
        </div>
        <div className="mt-1 text-xs leading-5 text-slate-500">
          Master Admin can manage all built-in roles and create custom
          role templates. Admin can manage Admin, Supervisor, Technician
          and Viewer. Supervisor can manage Technician and Viewer. Custom
          roles keep a built-in permission level underneath, so existing
          AMT security rules remain enforced.
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Menu Access</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {users.map((target) => {
                const access = Array.isArray(target.menu_access)
                  ? target.menu_access
                  : ALL_MENU_KEYS;
                const manageable = canManageTarget(user, target);
                const protectedOwner = isFebro(target);
                const targetRoleOptions = availableRoles(user);

                return (
                  <tr
                    key={target.id}
                    className="hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        <span>{target.name}</span>
                        {protectedOwner && (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                            Owner
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-slate-600">
                      {target.email}
                    </td>

                    <td className="px-4 py-3 text-slate-500">
                      {target.auth_provider}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex min-w-[180px] flex-col gap-1.5">
                        {target.role_profile_name && (
                          <div className="text-xs font-semibold text-blue-700">
                            {target.role_profile_name}
                          </div>
                        )}

                        <select
                          value={target.role}
                          onChange={(event) =>
                            changeRole(
                              target,
                              event.target.value
                            )
                          }
                          disabled={
                            !manageable ||
                            target.id === user.id ||
                            protectedOwner
                          }
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {!targetRoleOptions.includes(target.role) && (
                            <option value={target.role}>
                              {target.role}
                            </option>
                          )}

                          {targetRoleOptions.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>

                        {!protectedOwner &&
                          target.role !==
                            "master_admin" && (
                          <select
                            value={
                              target.role_profile_id ||
                              ""
                            }
                            onChange={(event) =>
                              changeRoleProfile(
                                target,
                                event.target.value
                              )
                            }
                            disabled={
                              !manageable ||
                              target.id === user.id
                            }
                            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="">
                              No custom role
                            </option>

                            {compatibleProfiles.map(
                              (profile) => (
                                <option
                                  key={profile.id}
                                  value={profile.id}
                                >
                                  {profile.name}
                                </option>
                              )
                            )}
                          </select>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={
                          !manageable ||
                          target.id === user.id ||
                          target.role === "master_admin" ||
                          Boolean(
                            target.role_profile_id
                          )
                        }
                        onClick={() => openAccess(target)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {target.role === "master_admin"
                          ? "All menus"
                          : target.role_profile_id
                            ? `${access.length} menu(s) · role managed`
                            : `${access.length} menu(s)`}
                      </button>
                    </td>

                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {fmtDate(target.created_at)}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {target.id !== user.id &&
                        manageable &&
                        !protectedOwner && (
                          <button
                            type="button"
                            onClick={() => remove(target)}
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
            text="No users available for this role"
          />
        )}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>

          <TextInput
            label="Name"
            value={form.name}
            onChange={(event) =>
              setForm({ ...form, name: event.target.value })
            }
          />

          <TextInput
            label="Email"
            type="email"
            required
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
          />

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Password{" "}
              <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={form.password}
                onChange={(event) =>
                  setForm({
                    ...form,
                    password: event.target.value,
                  })
                }
                className="w-full rounded-md border border-slate-200 px-3 py-2 pr-11 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() =>
                  setShowPassword((current) => !current)
                }
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700"
                aria-label={
                  showPassword ? "Hide password" : "Show password"
                }
                title={
                  showPassword ? "Hide password" : "Show password"
                }
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px]">
              {form.password.length >= 12 ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-emerald-600">
                    Minimum 12 characters
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-slate-400">
                    Minimum 12 characters
                  </span>
                </>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Re-type Password{" "}
              <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={form.confirm_password}
                onChange={(event) =>
                  setForm({
                    ...form,
                    confirm_password: event.target.value,
                  })
                }
                className="w-full rounded-md border border-slate-200 px-3 py-2 pr-11 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() =>
                  setShowPassword((current) => !current)
                }
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700"
                aria-label={
                  showPassword ? "Hide password" : "Show password"
                }
                title={
                  showPassword ? "Hide password" : "Show password"
                }
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {form.confirm_password && (
              <div className="mt-1 flex items-center gap-1 text-[11px]">
                {form.password === form.confirm_password ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-600">
                      Passwords match
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-red-500">
                      Passwords do not match
                    </span>
                  </>
                )}
              </div>
            )}
          </div>


          <SelectInput
            label="Custom Role Profile (optional)"
            value={
              form.role_profile_id
            }
            onChange={(event) => {
              const profileId =
                event.target.value;

              const profile =
                compatibleProfiles.find(
                  (item) =>
                    item.id ===
                    profileId
                );

              if (!profile) {
                setForm({
                  ...form,
                  role_profile_id:
                    "",
                });
                return;
              }

              setForm({
                ...form,
                role_profile_id:
                  profile.id,
                role:
                  profile.base_role,
                menu_access: [
                  ...(
                    profile.menu_access ||
                    []
                  ),
                ],
              });
            }}
          >
            <option value="">
              Use built-in role
            </option>

            {compatibleProfiles.map(
              (profile) => (
                <option
                  key={profile.id}
                  value={profile.id}
                >
                  {profile.name} — {profile.base_role}
                </option>
              )
            )}
          </SelectInput>

          <SelectInput
            label="Role"
            value={form.role}
            disabled={
              profileSelected
            }
            onChange={(event) => {
              const role = event.target.value;
              setForm({
                ...form,
                role,
                role_profile_id:
                  "",
                menu_access:
                  role === "master_admin"
                    ? [...ALL_MENU_KEYS]
                    : form.menu_access,
              });
            }}
          >
            {createRoles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </SelectInput>

          <MenuCheckboxes
            value={form.menu_access}
            allowedKeys={
              masterSelected
                ? ALL_MENU_KEYS
                : delegableMenuKeys
            }
            disabled={
              masterSelected ||
              profileSelected
            }
            disabledMessage={
              profileSelected
                ? "Menu access is managed by the selected custom role profile."
                : "Master Admin always has access to all menus."
            }
            onChange={(menu_access) =>
              setForm({ ...form, menu_access })
            }
          />

          <DialogFooter>
            <Btn variant="outline" onClick={() => setDialog(false)}>
              Cancel
            </Btn>
            <Btn
              onClick={create}
              disabled={
                form.password.length < 12 ||
                !form.confirm_password ||
                form.password !== form.confirm_password
              }
            >
              Create
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(accessTarget)}
        onOpenChange={(open) => {
          if (!open) setAccessTarget(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Menu Access — {accessTarget?.name}
            </DialogTitle>
          </DialogHeader>

          <MenuCheckboxes
            value={accessValue}
            allowedKeys={
              accessTarget?.role ===
              "master_admin"
                ? ALL_MENU_KEYS
                : delegableMenuKeys
            }
            disabled={
              accessTarget?.role ===
                "master_admin"
            }
            onChange={setAccessValue}
          />

          <DialogFooter>
            <Btn variant="outline" onClick={() => setAccessTarget(null)}>
              Cancel
            </Btn>
            <Btn
              onClick={saveAccess}
              disabled={accessTarget?.role === "master_admin"}
            >
              Save Access
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
