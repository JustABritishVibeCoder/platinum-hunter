/** Library management that spans catalogs and games. */
import { bundledCatalogs, findCatalog } from "../../catalog";
import type { SqlDriver } from "../driver";
import { selectOne } from "../driver";
import { installCatalog } from "./catalogImport";

const removedKey = (catalogId: string) => `catalog_removed:${catalogId}`;

/** Deletes a game and everything attached to it. Bundled catalogs stay removed. */
export async function removeGame(db: SqlDriver, gameId: string): Promise<void> {
  const g = await selectOne<{ catalog_id: string | null }>(db, "SELECT catalog_id FROM games WHERE id = ?", [gameId]);
  const st = [{ sql: "DELETE FROM games WHERE id = ?", params: [gameId] }];
  if (g?.catalog_id) st.push({ sql: "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, '1')", params: [removedKey(g.catalog_id)] });
  await db.batch(st);
}

export async function isCatalogRemoved(db: SqlDriver, catalogId: string): Promise<boolean> {
  return !!(await selectOne(db, "SELECT 1 FROM app_meta WHERE key = ?", [removedKey(catalogId)]));
}

/** Installs/refreshes every bundled catalog the user has not removed. */
export async function syncBundledCatalogs(db: SqlDriver): Promise<void> {
  for (const c of bundledCatalogs()) {
    if (!(await isCatalogRemoved(db, c.catalogId))) await installCatalog(db, c);
  }
}

export async function restoreCatalog(db: SqlDriver, catalogId: string): Promise<void> {
  const c = findCatalog(catalogId);
  if (!c) throw new Error("Unknown catalog");
  await db.execute("DELETE FROM app_meta WHERE key = ?", [removedKey(catalogId)]);
  await installCatalog(db, c);
}

export async function removedCatalogs(db: SqlDriver): Promise<{ id: string; title: string; platform: string }[]> {
  const out = [];
  for (const c of bundledCatalogs()) {
    if (await isCatalogRemoved(db, c.catalogId)) out.push({ id: c.catalogId, title: c.game.title, platform: c.game.platform });
  }
  return out;
}
