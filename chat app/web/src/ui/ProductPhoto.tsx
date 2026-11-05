import { useEffect, useState } from "react";
import { assetForSrc } from "../../../shared/catalog";

export function ProductPhoto({
  src,
  alt,
  className,
  loading = "lazy",
}: {
  src?: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [failed, setFailed] = useState(false);
  const meta = assetForSrc(src);

  useEffect(() => {
    setFailed(false);
  }, [src]);
  const label = alt || meta?.alt || "Photograph unavailable";

  if (!src || failed) {
    return (
      <span className={`photo-fallback${className ? ` ${className}` : ""}`} role="img" aria-label={label}>
        Photograph unavailable
      </span>
    );
  }

  return (
    <img
      key={src}
      src={src}
      alt={label}
      className={className}
      style={{ objectFit: meta?.fit ?? "cover", objectPosition: meta?.objectPosition ?? "50% 50%" }}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
