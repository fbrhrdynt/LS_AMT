import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { Loader2 } from "lucide-react";
import {
  AuthProvider,
  useAuth,
  canManage,
  canManageUsers,
  hasLicenseFeature,
  hasMenuAccess,
  isAdmin,
  isMasterAdmin,
} from "@/context/AuthContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import EquipmentList from "@/pages/EquipmentList";
import EquipmentDetail from "@/pages/EquipmentDetail";
import MaintenanceList from "@/pages/MaintenanceList";
import Calibration from "@/pages/Calibration";
import Inventory from "@/pages/Inventory";
import Clients from "@/pages/Clients";
import Jobs from "@/pages/Jobs";
import JobDetail from "@/pages/JobDetail";
import ImportWizard from "@/pages/ImportWizard";
import Reports from "@/pages/Reports";
import Audit from "@/pages/Audit";
import UsersPage from "@/pages/Users";
import SettingsPage from "@/pages/Settings";
import VersionHistory from "@/pages/VersionHistory";
import RoleProfiles from "@/pages/RoleProfiles";
import PublicEquipment from "@/pages/PublicEquipment";

function FullLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Loading…
    </div>
  );
}

function NoAccess() {
  return (
    <AppLayout>
      <div className="mx-auto mt-16 max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
        <h2 className="font-heading text-lg font-bold text-slate-900">
          Menu access not granted
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Contact an administrator if you need access to this menu.
        </p>
      </div>
    </AppLayout>
  );
}

function Protected({
  menu,
  feature,
  children,
}) {
  const {
    user,
    license,
  } = useAuth();
  if (user === null) return <FullLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (menu && !hasMenuAccess(user, menu)) return <NoAccess />;
  if (
    feature &&
    !hasLicenseFeature(
      license,
      feature
    )
  ) {
    return <NoAccess />;
  }
  return <AppLayout>{children}</AppLayout>;
}

function RoleRoute({ allow, menu, children }) {
  const { user } = useAuth();
  if (user === null) return <FullLoader />;
  if (!user) return <Navigate to="/login" replace />;

  if (!allow(user)) {
    return (
      <AppLayout>
        <div className="mx-auto mt-16 max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
          <h2 className="font-heading text-lg font-bold text-slate-900">Not authorized</h2>
          <p className="mt-2 text-sm text-slate-500">Your role does not have access to this page.</p>
        </div>
      </AppLayout>
    );
  }

  if (menu && !hasMenuAccess(user, menu)) return <NoAccess />;

  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/q/e/:token" element={<PublicEquipment />} />
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected menu="dash"><Dashboard /></Protected>} />
      <Route path="/equipment" element={<Protected menu="eq"><EquipmentList /></Protected>} />
      <Route path="/equipment/:id" element={<Protected menu="eq"><EquipmentDetail /></Protected>} />
      <Route path="/maintenance" element={<Protected menu="mnt"><MaintenanceList /></Protected>} />
      <Route path="/calibration" element={<Protected menu="cal"><Calibration /></Protected>} />
      <Route path="/inventory" element={<Protected menu="inv"><Inventory /></Protected>} />
      <Route path="/clients" element={<Protected menu="cli"><Clients /></Protected>} />
      <Route path="/jobs" element={<Protected menu="job"><Jobs /></Protected>} />
      <Route path="/jobs/:id" element={<Protected menu="job"><JobDetail /></Protected>} />
      <Route path="/import" element={<RoleRoute allow={canManage} menu="imp"><ImportWizard /></RoleRoute>} />
      <Route path="/reports" element={<Protected menu="rep"><Reports /></Protected>} />
      <Route path="/audit" element={<Protected menu="aud" feature="audit_log"><Audit /></Protected>} />
      <Route path="/users" element={<RoleRoute allow={canManageUsers} menu="usr"><UsersPage /></RoleRoute>} />
      <Route path="/settings" element={<RoleRoute allow={isAdmin} menu="set"><SettingsPage /></RoleRoute>} />
      <Route path="/version-history" element={<RoleRoute allow={isAdmin} menu="set"><VersionHistory /></RoleRoute>} />
      <Route path="/version-log" element={<Navigate to="/version-history" replace />} />
      <Route path="/roles" element={<RoleRoute allow={isMasterAdmin} menu="usr"><RoleProfiles /></RoleRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <CurrencyProvider>
          <BrowserRouter>
            <AppRoutes />
            <Toaster position="top-right" richColors />
          </BrowserRouter>
        </CurrencyProvider>
      </AuthProvider>
    </div>
  );
}

export default App;
