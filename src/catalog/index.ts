import gtaVPs5 from "./data/gta-v-ps5.json";
import { parseCatalog, type Catalog } from "./schema";

/** Curated datasets shipped with the app. Each is validated at load time. */
const RAW_CATALOGS: unknown[] = [gtaVPs5];

let cache: Catalog[] | null = null;

export function bundledCatalogs(): Catalog[] {
  if (cache) return cache;
  const out: Catalog[] = [];
  for (const raw of RAW_CATALOGS) {
    const parsed = parseCatalog(raw);
    if (parsed.ok) out.push(parsed.catalog);
    else console.error("Bundled catalog failed validation", parsed.errors);
  }
  cache = out;
  return out;
}

export function findCatalog(catalogId: string): Catalog | undefined {
  return bundledCatalogs().find((c) => c.catalogId === catalogId);
}

export { parseCatalog };
export type { Catalog };
