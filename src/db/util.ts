export const nowIso = (d: Date = new Date()) => d.toISOString();

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const bool = (v: unknown) => v === 1 || v === true || v === "1";
