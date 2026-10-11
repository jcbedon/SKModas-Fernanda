import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/App";
import { loginUser, seedSuperadmin } from "@/lib/api";
import { toast } from "sonner";
import { User, Lock, Eye, EyeOff, ShoppingBag, Shield, Truck, Headphones } from "lucide-react";

// WhatsApp numbers
const WHATSAPP_USA = "+12019954770";
const WHATSAPP_ECUADOR = "+593998541082";

// Logo URL - Didier Shop white logo
const DIDIER_LOGO = "https://customer-assets-v7afamib.emergentagent.net/job_783f5be0-cb6a-4591-926c-0e17259f2605/artifacts/4131318e45b6a6e1_Logo_Didier_Shop_%28Blanco%29.png_2K_20261010194132.webp";

// Video URL
const PROMO_VIDEO = "https://customer-assets-v7afamib.emergentagent.net/job_783f5be0-cb6a-4591-926c-0e17259f2605/artifacts/dbb507bb65a16b55_Woman_holding_shopping_bags_smiling_20261010221028.mp4";

// Modern background image
const MODERN_BG = "https://static.prod-images.emergentagent.com/jobs/783f5be0-cb6a-4591-926c-0e17259f2605/images/d2da390a97bccb7db2448db8fab546a8bc7d5be31cf497a1764845b832513e7c.jpeg";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ identifier: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  
  // Video ref for speed control
  const videoRef = useRef(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check for reduced motion preference
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    
    const handleChange = (e) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Set video playback rate to 0.75 (25% slower)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 0.75;
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await loginUser(formData);
      const userData = response.data;
      login(userData);
      toast.success(`Bienvenido, ${userData.name}!`);
      if (userData.role === "superadmin") navigate("/superadmin");
      else if (userData.role === "admin" || userData.role === "employee") navigate("/admin");
      else navigate("/dashboard");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  const handleSeedSuperadmin = async () => {
    try {
      const response = await seedSuperadmin();
      toast.success(`Superadmin creado: ${response.data.email}`);
    } catch (error) {
      toast.info(error.response?.data?.message || "Superadmin ya existe");
    }
  };

  const openWhatsApp = (number) => {
    const cleanNumber = number.replace(/[^0-9+]/g, '');
    window.open(`https://wa.me/${cleanNumber.replace('+', '')}`, '_blank');
  };

  return (
    <div 
      className="min-h-screen w-full overflow-x-hidden"
      style={{
        background: '#0a0f1a',
      }}
    >
      {/* Background with modern texture */}
      <div 
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `url(${MODERN_BG})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          opacity: 0.85,
        }}
      />
      
      {/* Subtle gradient overlay */}
      <div 
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at 30% 20%, rgba(243, 174, 195, 0.05) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 80%, rgba(243, 174, 195, 0.03) 0%, transparent 50%)
          `,
        }}
      />

      {/* Main content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        
        {/* Header - Desktop (no WhatsApp button) */}
        <header className="hidden md:flex items-center justify-between px-6 lg:px-12 py-4 max-w-[1240px] mx-auto w-full">
          <img 
            src={DIDIER_LOGO} 
            alt="Didier Shop" 
            className="h-[100px] lg:h-[120px] w-auto object-contain"
          />
        </header>

        {/* Main content area */}
        <main className="flex-1 flex items-center justify-center px-4 md:px-6 lg:px-12 py-6 md:py-8">
          <div className="w-full max-w-[1240px] mx-auto">
            
            {/* Mobile layout */}
            <div className="md:hidden flex flex-col items-center gap-4">
              {/* Logo mobile */}
              <img 
                src={DIDIER_LOGO} 
                alt="Didier Shop" 
                className="h-[90px] w-auto object-contain mb-2"
              />
              
              {/* Title mobile */}
              <div className="text-center mb-2">
                <h1 className="font-bold leading-tight" style={{ fontFamily: 'Poppins, sans-serif' }}>
                  <span className="text-white text-[28px]">Tus tiendas favoritas,</span>
                  <br />
                  <span style={{ color: '#F3AEC3' }} className="text-[28px]">más cerca de ti</span>
                </h1>
                <p className="text-[13px] mt-2" style={{ color: '#C8C8CE' }}>
                  Compras en Estados Unidos, fáciles y seguras
                </p>
              </div>
              
              {/* Video mobile - no controls */}
              <div 
                className="w-full rounded-2xl overflow-hidden relative"
                style={{
                  border: '1px solid #F6C3D1',
                  boxShadow: '0 0 20px rgba(243, 174, 195, 0.15)',
                }}
              >
                <video
                  ref={videoRef}
                  src={PROMO_VIDEO}
                  className="w-full h-auto"
                  style={{ objectFit: 'contain' }}
                  autoPlay={!prefersReducedMotion}
                  muted
                  loop
                  playsInline
                  onLoadedMetadata={(e) => { e.target.playbackRate = 0.75; }}
                />
              </div>
              
              {/* Login card mobile */}
              <div 
                className="w-full mt-4 rounded-[20px] p-5"
                style={{
                  background: 'linear-gradient(180deg, rgba(243, 174, 195, 0.08) 0%, rgba(10, 15, 26, 0.95) 30%)',
                  border: '1px solid #F6C3D1',
                  boxShadow: '0 0 30px rgba(243, 174, 195, 0.1)',
                  backdropFilter: 'blur(10px)',
                }}
              >
                {/* Shopping bag icon */}
                <div className="flex justify-center mb-4">
                  <div 
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ 
                      background: 'rgba(243, 174, 195, 0.15)',
                      border: '1px solid rgba(243, 174, 195, 0.3)',
                    }}
                  >
                    <ShoppingBag className="w-6 h-6" style={{ color: '#F3AEC3' }} />
                  </div>
                </div>
                
                <h2 className="text-xl font-bold text-white text-center mb-1">Iniciar Sesión</h2>
                <p className="text-sm text-center mb-5" style={{ color: '#C8C8CE' }}>
                  Plataforma de Gestión – Personal Shoppers
                </p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-white mb-1.5 block">Usuario</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
                      <input
                        type="text"
                        data-testid="login-identifier-input"
                        placeholder="Usuario"
                        className="w-full h-12 pl-10 pr-4 rounded-xl text-white placeholder-gray-500 outline-none transition-all focus:ring-2"
                        style={{ 
                          background: 'rgba(30, 30, 40, 0.9)',
                          border: '1px solid rgba(200, 200, 206, 0.2)',
                        }}
                        value={formData.identifier}
                        onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-white mb-1.5 block">Contraseña</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
                      <input
                        type={showPassword ? "text" : "password"}
                        data-testid="login-password-input"
                        placeholder="Contraseña"
                        className="w-full h-12 pl-10 pr-12 rounded-xl text-white placeholder-gray-500 outline-none transition-all focus:ring-2"
                        style={{ 
                          background: 'rgba(30, 30, 40, 0.9)',
                          border: '1px solid rgba(200, 200, 206, 0.2)',
                        }}
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  
                  <button
                    type="submit"
                    data-testid="login-submit-btn"
                    disabled={loading}
                    className="w-full h-12 rounded-xl font-bold text-black transition-all hover:opacity-90 active:scale-[0.98]"
                    style={{ background: '#F3AEC3' }}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></span>
                        Ingresando...
                      </span>
                    ) : "Iniciar sesión"}
                  </button>
                </form>
                
                {/* WhatsApp buttons */}
                <div className="mt-4 space-y-2">
                  <button
                    onClick={() => openWhatsApp(WHATSAPP_ECUADOR)}
                    className="w-full h-12 rounded-xl font-medium flex items-center justify-center gap-2 transition-all hover:bg-white/5"
                    style={{ 
                      border: '1px solid #F6C3D1',
                      color: 'white',
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#F3AEC3">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    <span>WhatsApp Ecuador</span>
                  </button>
                  <button
                    onClick={() => openWhatsApp(WHATSAPP_USA)}
                    className="w-full h-12 rounded-xl font-medium flex items-center justify-center gap-2 transition-all hover:bg-white/5"
                    style={{ 
                      border: '1px solid #F6C3D1',
                      color: 'white',
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#F3AEC3">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    <span>WhatsApp USA</span>
                  </button>
                </div>
                
                {/* Seed superadmin - hidden but functional */}
                <button
                  onClick={handleSeedSuperadmin}
                  data-testid="seed-superadmin-btn"
                  className="mt-4 w-full text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Crear Superadmin (demo)
                </button>
              </div>
            </div>
            
            {/* Desktop layout */}
            <div className="hidden md:flex gap-8 lg:gap-10 items-start">
              {/* Left column - Title and Video */}
              <div className="flex-1" style={{ maxWidth: '62%' }}>
                {/* Title */}
                <div className="mb-6">
                  <h1 
                    className="font-bold leading-[1.1]" 
                    style={{ 
                      fontFamily: 'Poppins, sans-serif',
                      fontSize: 'clamp(40px, 4vw, 54px)',
                    }}
                  >
                    <span className="text-white">Tus tiendas favoritas,</span>
                    <br />
                    <span style={{ color: '#F3AEC3' }}>más cerca de ti</span>
                  </h1>
                  <p className="text-base mt-3" style={{ color: '#C8C8CE' }}>
                    Compras en Estados Unidos, fáciles y seguras
                  </p>
                </div>
                
                {/* Video - no controls, just the video */}
                <div 
                  className="rounded-2xl overflow-hidden relative"
                  style={{
                    border: '1px solid #F6C3D1',
                    boxShadow: '0 0 30px rgba(243, 174, 195, 0.15)',
                  }}
                >
                  <video
                    ref={videoRef}
                    src={PROMO_VIDEO}
                    className="w-full h-auto"
                    style={{ objectFit: 'contain' }}
                    autoPlay={!prefersReducedMotion}
                    muted
                    loop
                    playsInline
                    onLoadedMetadata={(e) => { e.target.playbackRate = 0.75; }}
                  />
                </div>
              </div>
              
              {/* Right column - Login card */}
              <div 
                className="rounded-[20px] p-7 lg:p-8"
                style={{
                  width: '380px',
                  minWidth: '380px',
                  maxWidth: '420px',
                  background: 'linear-gradient(180deg, rgba(243, 174, 195, 0.08) 0%, rgba(10, 15, 26, 0.95) 30%)',
                  border: '1px solid #F6C3D1',
                  boxShadow: '0 0 40px rgba(243, 174, 195, 0.12)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                {/* Shopping bag icon */}
                <div className="flex justify-center mb-5">
                  <div 
                    className="w-14 h-14 rounded-xl flex items-center justify-center"
                    style={{ 
                      background: 'rgba(243, 174, 195, 0.15)',
                      border: '1px solid rgba(243, 174, 195, 0.3)',
                    }}
                  >
                    <ShoppingBag className="w-7 h-7" style={{ color: '#F3AEC3' }} />
                  </div>
                </div>
                
                <h2 className="text-2xl font-bold text-white text-center mb-1">Iniciar Sesión</h2>
                <p className="text-sm text-center mb-6" style={{ color: '#C8C8CE' }}>
                  Plataforma de Gestión – Personal Shoppers
                </p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-white mb-2 block">Usuario</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
                      <input
                        type="text"
                        data-testid="login-identifier-input"
                        placeholder="Usuario"
                        className="w-full h-[50px] pl-11 pr-4 rounded-xl text-white placeholder-gray-500 outline-none transition-all focus:ring-2 focus:ring-pink-300/50"
                        style={{ 
                          background: 'rgba(30, 30, 40, 0.9)',
                          border: '1px solid rgba(200, 200, 206, 0.2)',
                        }}
                        value={formData.identifier}
                        onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-white mb-2 block">Contraseña</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#9CA3AF' }} />
                      <input
                        type={showPassword ? "text" : "password"}
                        data-testid="login-password-input"
                        placeholder="Contraseña"
                        className="w-full h-[50px] pl-11 pr-12 rounded-xl text-white placeholder-gray-500 outline-none transition-all focus:ring-2 focus:ring-pink-300/50"
                        style={{ 
                          background: 'rgba(30, 30, 40, 0.9)',
                          border: '1px solid rgba(200, 200, 206, 0.2)',
                        }}
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>
                  
                  <button
                    type="submit"
                    data-testid="login-submit-btn"
                    disabled={loading}
                    className="w-full h-[50px] rounded-xl font-bold text-black transition-all hover:opacity-90 active:scale-[0.98]"
                    style={{ background: '#F3AEC3' }}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></span>
                        Ingresando...
                      </span>
                    ) : "Iniciar sesión"}
                  </button>
                </form>
                
                {/* WhatsApp buttons */}
                <div className="mt-5 space-y-3">
                  <button
                    onClick={() => openWhatsApp(WHATSAPP_ECUADOR)}
                    className="w-full h-[50px] rounded-xl font-medium flex items-center justify-center gap-2 transition-all hover:bg-white/5"
                    style={{ 
                      border: '1px solid #F6C3D1',
                      color: 'white',
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#F3AEC3">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    <span>WhatsApp Ecuador</span>
                  </button>
                  <button
                    onClick={() => openWhatsApp(WHATSAPP_USA)}
                    className="w-full h-[50px] rounded-xl font-medium flex items-center justify-center gap-2 transition-all hover:bg-white/5"
                    style={{ 
                      border: '1px solid #F6C3D1',
                      color: 'white',
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#F3AEC3">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    <span>WhatsApp USA</span>
                  </button>
                </div>
                
                {/* Seed superadmin - hidden but functional */}
                <button
                  onClick={handleSeedSuperadmin}
                  data-testid="seed-superadmin-btn"
                  className="mt-5 w-full text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Crear Superadmin (demo)
                </button>
              </div>
            </div>
          </div>
        </main>
        
        {/* Footer benefits - Desktop only */}
        <footer className="hidden md:block pb-8 pt-4">
          <div className="max-w-[1240px] mx-auto px-6 lg:px-12">
            <div className="flex items-center justify-center gap-8 lg:gap-16">
              <div className="flex items-center gap-3">
                <Shield className="w-6 h-6" style={{ color: '#F3AEC3' }} />
                <span className="text-sm" style={{ color: '#C8C8CE' }}>100% Seguro</span>
              </div>
              <div className="w-px h-5 bg-gray-700"></div>
              <div className="flex items-center gap-3">
                <Truck className="w-6 h-6" style={{ color: '#F3AEC3' }} />
                <span className="text-sm" style={{ color: '#C8C8CE' }}>Envíos confiables</span>
              </div>
              <div className="w-px h-5 bg-gray-700"></div>
              <div className="flex items-center gap-3">
                <Headphones className="w-6 h-6" style={{ color: '#F3AEC3' }} />
                <span className="text-sm" style={{ color: '#C8C8CE' }}>Soporte personalizado</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
