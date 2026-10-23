/**
 * Wires the app to its backends. In the desktop app: Rust SQLite + Rust PSN client.
 * In a plain browser during development: an in-memory preview database and no PSN.
 */
import { invoke } from "@tauri-apps/api/core";
import type { SqlDriver } from "../db/driver";
import { syncBundledCatalogs } from "../db/repo/library";
import { migrate } from "../db/migrations";
import { isTauri, tauriDriver } from "../db/tauriDriver";
import { tauriPsnGateway, unavailablePsnGateway, type PsnGateway } from "../psn/gateway";

export interface Services {
  db: SqlDriver;
  psn: PsnGateway;
  desktop: boolean;
}

let services: Services | null = null;

export function getServices(): Services {
  if (!services) throw new Error("Services not initialised");
  return services;
}

export async function initServices(): Promise<Services> {
  if (services) return services;
  let db: SqlDriver;
  const desktop = isTauri();
  if (desktop) {
    db = tauriDriver;
  } else if (import.meta.env.DEV) {
    const { createPreviewDriver } = await import("../db/previewDriver");
    db = await createPreviewDriver();
  } else {
    throw new Error("Platinum Hunter must be run as the desktop app.");
  }
  await migrate(db);
  // Keep bundled curated datasets current (idempotent; never touches player data).
  await syncBundledCatalogs(db);
  services = { db, psn: desktop ? tauriPsnGateway : unavailablePsnGateway, desktop };
  return services;
}

export async function cachedImage(url: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>("image_cached", { url });
  } catch {
    return null;
  }
}
