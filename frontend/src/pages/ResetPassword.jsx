import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import BrandLogo from "@/components/BrandLogo";
import { api, formatApiError } from "@/lib/api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  const valid = useMemo(
    () =>
      token.length >= 32 &&
      password.length >= 12 &&
      password === confirmPassword,
    [token, password, confirmPassword]
  );

  const submit = async (event) => {
    event.preventDefault();

    if (!token) {
      toast.error("Password reset token is missing");
      return;
    }
    if (password.length < 12) {
      toast.error("Password must contain at least 12 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Password confirmation does not match");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/password-reset/confirm", {
        token,
        password,
      });
      setComplete(true);
      toast.success("Password updated");
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail) ||
          "Unable to reset password"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <BrandLogo
          fallback="/amt-logo-tagline.png"
          alt="AMT — Asset Maintenance Tracker"
          className="mx-auto mb-7 h-16 max-w-[280px] w-auto object-contain"
        />

        {complete ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h1 className="mt-4 font-heading text-2xl font-bold text-slate-900">
              Password updated
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Your password has been changed and existing AMT sessions have been signed out.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <KeyRound className="h-5 w-5" />
              </div>
              <h1 className="font-heading text-2xl font-bold text-slate-900">
                Create new password
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Use at least 12 characters.
              </p>
            </div>

            {!token && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                This reset link is missing its security token. Request a new reset email.
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  New Password
                </label>
                <div className="relative mt-1">
                  <input
                    type={show ? "text" : "password"}
                    required
                    minLength={12}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2.5 pr-11 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    data-testid="reset-password-new"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((current) => !current)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700"
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Re-type Password
                </label>
                <input
                  type={show ? "text" : "password"}
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  data-testid="reset-password-confirm"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !valid}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                data-testid="reset-password-submit"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Update password
              </button>
            </form>

            <div className="mt-5 text-center">
              <Link
                to="/forgot-password"
                className="text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                Request a new reset link
              </Link>
            </div>
          </>
        )}

        <div className="mt-7 border-t border-slate-100 pt-5 text-center text-xs text-slate-400">
          Powered by LogiSource Digital
        </div>
      </div>
    </div>
  );
}
