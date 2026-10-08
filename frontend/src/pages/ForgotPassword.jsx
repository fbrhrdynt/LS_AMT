import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import BrandLogo from "@/components/BrandLogo";
import { api, formatApiError } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      const { data } = await api.post(
        "/auth/password-reset/request",
        { email: email.trim().toLowerCase() }
      );
      setMessage(
        data?.message ||
          "If the email address is registered, a reset link will be sent shortly."
      );
      setSent(true);
    } catch (error) {
      toast.error(
        formatApiError(error.response?.data?.detail) ||
          "Unable to request password reset"
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

        {!sent ? (
          <>
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <Mail className="h-5 w-5" />
              </div>
              <h1 className="font-heading text-2xl font-bold text-slate-900">
                Reset password
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Enter your AMT account email. If it is registered, we will send a secure password reset link.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Email
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="you@company.com"
                  data-testid="forgot-password-email"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                data-testid="forgot-password-submit"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Send reset link
              </button>
            </form>
          </>
        ) : (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Mail className="h-5 w-5" />
            </div>
            <h1 className="font-heading text-2xl font-bold text-slate-900">
              Check your email
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">{message}</p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Check your spam/junk folder if the message does not appear within a few minutes.
            </p>
          </div>
        )}

        <Link
          to="/login"
          className="mt-7 flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        <div className="mt-7 border-t border-slate-100 pt-5 text-center text-xs text-slate-400">
          Powered by LogiSource Digital
        </div>
      </div>
    </div>
  );
}
