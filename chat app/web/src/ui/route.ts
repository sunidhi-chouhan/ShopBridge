import { useCallback, useEffect, useState } from "react";
import type { Section } from "./nav";

/**
 * Hash routes so a refresh keeps your place and conversations can be deep-linked:
 *   #/shop   #/shop/<productId>   #/orders   #/inbox   #/inbox/<orderId>   #/queue   #/products   #/account
 */
export type Route = { section: Section | null; orderId: string | null; productId: string | null };

const SECTIONS: Section[] = ["shop", "orders", "inbox", "account", "products", "queue"];
const ID = /^[a-z0-9]{6,40}$/i;

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const section = SECTIONS.includes(parts[0] as Section) ? (parts[0] as Section) : null;
  const rest = parts[1] && ID.test(parts[1]) ? parts[1] : null;
  return {
    section,
    orderId: section === "inbox" ? rest : null,
    productId: section === "shop" ? rest : null,
  };
}

export function routeHref(section: Section, id?: string | null): string {
  return id ? `#/${section}/${id}` : `#/${section}`;
}

export function navigate(section: Section, id?: string | null): void {
  const next = routeHref(section, id);
  if (window.location.hash !== next) window.location.hash = next;
}

export function useRoute(): [Route, (section: Section, id?: string | null) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = useCallback((section: Section, id?: string | null) => navigate(section, id), []);
  return [route, go];
}
