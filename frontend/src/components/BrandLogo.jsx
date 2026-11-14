import { useEffect, useState } from "react";
import { API } from "@/lib/api";

export default function BrandLogo({
  fallback = "/amt-mark.png",
  alt = "AMT - Asset Maintenance Tracker",
  className = "",
  fetchPriority = "auto",
}) {
  const [useCustom, setUseCustom] = useState(true);
  const [version, setVersion] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => {
      setVersion(Date.now());
      setUseCustom(true);
    };

    window.addEventListener("amt-branding-changed", refresh);
    return () => window.removeEventListener("amt-branding-changed", refresh);
  }, []);

  return (
    <img
      src={useCustom ? `${API}/settings/app-logo?v=${version}` : fallback}
      alt={alt}
      className={className}
      fetchPriority={fetchPriority}
      loading="eager"
      decoding="async"
      onError={() => setUseCustom(false)}
    />
  );
}
