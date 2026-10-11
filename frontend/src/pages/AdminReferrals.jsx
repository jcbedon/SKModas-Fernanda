import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { getReferralBonus, setReferralBonus, getReferralStats } from "@/lib/api";
import { useRefreshOnTabFocus } from "@/hooks/useRefreshOnTabFocus";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Gift, DollarSign, Users, Save, TrendingUp } from "lucide-react";

function TopReferrerItem({ ref, index }) {
  const bgColor = index === 0 ? "bg-yellow-100 text-yellow-700" :
                  index === 1 ? "bg-gray-200 text-gray-700" :
                  index === 2 ? "bg-orange-100 text-orange-700" :
                  "bg-gray-100 text-gray-600";
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${bgColor}`}>
          {index + 1}
        </div>
        <div>
          <Badge variant="outline" className="font-bold">#{ref.customer_id}</Badge>
          <span className="ml-2 text-sm text-gray-600">{ref.name}</span>
        </div>
      </div>
      <Badge className="bg-green-100 text-green-700">
        {ref.referral_count} referidos
      </Badge>
    </div>
  );
}

export default function AdminReferrals() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const logoUrl = user?.tenant_logo || "https://customer-assets.emergentagent.com/job_compraenvivo/artifacts/qvyfsb43_WhatsApp%20Image%202026-02-03%20at%208.05.08%20PM.jpeg";
  const [currentBonus, setCurrentBonus] = useState(0);
  const [newBonus, setNewBonus] = useState("");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    try {
      const bonusRes = await getReferralBonus();
      const statsRes = await getReferralStats();
      setCurrentBonus(bonusRes.data.referral_bonus);
      setNewBonus(bonusRes.data.referral_bonus.toString());
      setStats(statsRes.data);
    } catch (error) {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Refresh whenever the user comes back to this tab.
  useRefreshOnTabFocus(() => loadData());

  const handleSaveBonus = async () => {
    const amount = parseFloat(newBonus);
    if (isNaN(amount) || amount < 0) {
      toast.error("Ingresa un monto válido");
      return;
    }
    setSaving(true);
    try {
      await setReferralBonus(amount);
      setCurrentBonus(amount);
      toast.success("Bono actualizado");
    } catch (error) {
      toast.error("Error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-red-600 border-t-transparent" />
      </div>
    );
  }

  const topReferrers = stats && stats.top_referrers ? stats.top_referrers : [];
  const totalBonusPaid = stats ? stats.total_bonus_paid : 0;

  return (
    <div className="app-bg">
      <div className="sticky top-0 z-50 border-b" style={{ background: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB' }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="back-btn">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-white rounded-lg p-1">
            <img src={logoUrl} alt="Logo" className="h-10 object-contain logo-transparent" />
          </div>
          <span className="font-bold text-slate-800 flex-1">Programa de Referidos</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <Card className="rounded-xl">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <Gift className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">Bono de Referido</h2>
                <p className="text-sm text-gray-500">Monto para ambos: quien refiere y nuevo cliente</p>
              </div>
            </div>

            <div className="bg-green-50 rounded-xl p-6 mb-6">
              <p className="text-sm text-gray-600 mb-2">Bono actual:</p>
              <p className="text-5xl font-extrabold text-green-600">${currentBonus.toFixed(2)}</p>
            </div>

            <div className="space-y-4">
              <Label>Nuevo monto (USD)</Label>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="5.00"
                    value={newBonus}
                    onChange={(e) => setNewBonus(e.target.value)}
                    className="pl-10 h-14 text-2xl font-bold rounded-xl"
                    data-testid="referral-bonus-input"
                  />
                </div>
                <Button
                  onClick={handleSaveBonus}
                  disabled={saving}
                  className="h-14 px-6 font-bold rounded-xl" style={{ background: '#1E3A5F', color: 'white' }}
                  data-testid="save-bonus-btn"
                >
                  <Save className="h-5 w-5 mr-2" />
                  Guardar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <TrendingUp className="h-6 w-6 text-blue-600 mb-2" />
              <p className="text-2xl font-extrabold">${totalBonusPaid.toFixed(2)}</p>
              <p className="text-xs text-gray-500">Bonos Pagados</p>
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <Users className="h-6 w-6 text-purple-600 mb-2" />
              <p className="text-2xl font-extrabold">{topReferrers.length}</p>
              <p className="text-xs text-gray-500">Referidores</p>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-xl">
          <CardContent className="p-4">
            <h3 className="font-bold text-slate-800 mb-4">Top Referidores</h3>
            {topReferrers.length > 0 ? (
              <div className="space-y-3">
                {topReferrers.map((r, i) => (
                  <TopReferrerItem key={r.customer_id} ref={r} index={i} />
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-500 py-8">Sin referidos aún</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
