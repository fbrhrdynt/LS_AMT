import { useEffect, useState } from "react";
import { API } from "@/lib/api";

export default function BrandLogo({
  fallback = "/amt-mark.png",
  alt = "AMT - Asset Maintenance Tracker",
  className = "",
  fetchPriority = "auto",
}) {
  const [useCustom, setUseCustom] = useState(true);
  // Keep a stable URL across page loads so the browser can reuse its cached logo.
  // The branding-changed event adds a one-time cache-buster after an admin uploads a new logo.
  const [version, setVersion] = useState("");

  useEffect(() => {
    const refresh = () => {
      setVersion(String(Date.now()));
      setUseCustom(true);
    };

    window.addEventListener("amt-branding-changed", refresh);
    return () => window.removeEventListener("amt-branding-changed", refresh);
  }, []);

  const logoUrl = version
    ? `${API}/settings/app-logo?v=${version}`
    : `${API}/settings/app-logo`;

  return (
    <img
      src={useCustom ? logoUrl : fallback}
      alt={alt}
      className={className}
      fetchPriority={fetchPriority}
      loading="eager"
      decoding="async"
      width="360"
      height="96"
      onError={() => setUseCustom(false)}
    />
  );
}
