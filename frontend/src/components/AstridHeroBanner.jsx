import { useAuth } from "@/App";
import { useState } from "react";

/**
 * Inline top hero banner used on the main dashboards for every tenant that
 * has uploaded a dashboard banner (managed from the superadmin panel).
 * Renders in-flow (not fixed). Uses the SAME image on desktop and mobile —
 * `object-fit: contain` shows the COMPLETE composition (no aggressive crop),
 * centered on a clean surface with light margins when the ratios differ.
 * If the tenant has no banner configured, nothing renders.
 */
export const AstridHeroBanner = () => {
  const { user } = useAuth();
  const bannerPath = user?.tenant_banner;
  const [bannerLoaded, setBannerLoaded] = useState(false);

  if (!bannerPath) return null;

  // Backend returns a path like "/api/uploads/..."; prepend REACT_APP_BACKEND_URL
  // for absolute-URL rendering that works from any origin.
  const bannerUrl = bannerPath.startsWith("http")
    ? bannerPath
    : `${process.env.REACT_APP_BACKEND_URL}${bannerPath}`;

  return (
    <>
      <style>{`
        .tenant-hero {
          width: 100%;
          overflow: hidden;
          background: #F7F8FA;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .tenant-hero-img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          object-position: center;
        }
        /* Desktop: adapt height to the image ratio within a comfortable band. */
        .tenant-hero { height: 360px; }
        @media (min-width: 1440px) { .tenant-hero { height: 420px; } }
        /* Mobile: preserve the full composition without cropping the subject. */
        @media (max-width: 767px)  { .tenant-hero { height: 240px; } }
        @media (max-width: 400px)  { .tenant-hero { height: 200px; } }
      `}</style>
      <div className="tenant-hero" data-testid="tenant-hero-banner" aria-hidden="true">
        <img
          className={`tenant-hero-img transition-opacity duration-200 ${bannerLoaded ? 'opacity-100' : 'opacity-0'}`}
          src={bannerUrl}
          alt=""
          loading="eager"
          decoding="async"
          fetchPriority="high"
          onLoad={() => setBannerLoaded(true)}
        />
      </div>
    </>
  );
};

export default AstridHeroBanner;
