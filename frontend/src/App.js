import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth, canManage, isAdmin } from "@/context/AuthContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import EquipmentList from "@/pages/EquipmentList";
import EquipmentDetail from "@/pages/EquipmentDetail";
import MaintenanceList from "@/pages/MaintenanceList";
import Inventory from "@/pages/Inventory";
import Clients from "@/pages/Clients";
import Jobs from "@/pages/Jobs";
import JobDetail from "@/pages/JobDetail";
import ImportWizard from "@/pages/ImportWizard";
import Reports from "@/pages/Reports";
import Audit from "@/pages/Audit";
import UsersPage from "@/pages/Users";

function FullLoader() {
  return <div className="flex min-h-screen items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>;
}

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) return <FullLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout>{children}</AppLayout>;
}

function RoleRoute({ allow, children }) {
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
  return <AppLayout>{children}</AppLayout>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/equipment" element={<Protected><EquipmentList /></Protected>} />
      <Route path="/equipment/:id" element={<Protected><EquipmentDetail /></Protected>} />
      <Route path="/maintenance" element={<Protected><MaintenanceList /></Protected>} />
      <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
      <Route path="/clients" element={<Protected><Clients /></Protected>} />
      <Route path="/jobs" element={<Protected><Jobs /></Protected>} />
      <Route path="/jobs/:id" element={<Protected><JobDetail /></Protected>} />
      <Route path="/import" element={<RoleRoute allow={canManage}><ImportWizard /></RoleRoute>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/audit" element={<Protected><Audit /></Protected>} />
      <Route path="/users" element={<RoleRoute allow={isAdmin}><UsersPage /></RoleRoute>} />
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
