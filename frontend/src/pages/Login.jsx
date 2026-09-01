import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth, formatApiError } from "@/context/AuthContext";

const LOGIN_IMG = "https://images.unsplash.com/photo-1564182842834-681b7be6de4b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1Mjh8MHwxfHNlYXJjaHwzfHxpbmR1c3RyaWFsJTIwZXF1aXBtZW50JTIwbWFpbnRlbmFuY2V8ZW58MHx8fHwxNzg4MDgxNDY1fDA&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      toast.success("Welcome back");
      nav("/");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Login failed");
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-slate-900 p-12 text-white lg:flex relative overflow-hidden">
        <img src={LOGIN_IMG} alt="Industrial maintenance" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="relative z-10">
          <img src="/amt-logo-tagline.png" alt="AMT — Asset Maintenance Tracker" className="h-24 w-auto rounded-lg bg-white/95 p-3" />
        </div>
        <div className="relative z-10 space-y-3">
          <h1 className="font-heading text-4xl font-bold leading-tight">Asset Maintenance Tracker</h1>
          <p className="max-w-md text-slate-300">Track every asset. Know every maintenance history. Search any equipment, open it, and see everything.</p>
          <div className="flex items-center gap-2 text-sm text-slate-400"><ShieldCheck className="h-4 w-4" /> A LogiSource Digital product</div>
        </div>
      </div>

      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 sm:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <img src="/amt-logo-tagline.png" alt="AMT — Asset Maintenance Tracker" className="h-16 w-auto" />
          </div>
          <h2 className="font-heading text-2xl font-bold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Access the maintenance management system</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</label>
              <input data-testid="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@company.com" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Password</label>
              <input data-testid="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••" />
            </div>
            <button data-testid="login-submit" type="submit" disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
