import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const DEFAULT_LOGO = "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";

export default function ModuleHeader({ title, children }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || DEFAULT_LOGO;

  return (
    <div className="sticky top-0 z-50 border-b" style={{ background: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB' }}>
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="bg-white rounded-lg p-1">
          <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
        </div>
        <span className="font-bold text-slate-800 flex-1">{title}</span>
        {children}
      </div>
    </div>
  );
}
