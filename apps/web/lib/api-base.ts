export const PROD_API_BASE = "https://api.vultstrike.com";

export function getApiBase(): string {
  const envBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";
  if (typeof window === "undefined") return envBase;

  const host = window.location.hostname;
  const isOfficialHost = host === "vultstrike.com" || host === "www.vultstrike.com";
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const envIsLocal = envBase.includes("localhost") || envBase.includes("127.0.0.1");
  const pageIsHttps = window.location.protocol === "https:";

  if (isOfficialHost && !isLocalHost && envIsLocal) {
    return PROD_API_BASE;
  }

  if (isOfficialHost && !isLocalHost && pageIsHttps && envBase.startsWith("http://")) {
    return PROD_API_BASE;
  }

  return envBase;
}
