import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "daily-totals.json");
export const LIFETIME_LIMIT = 50; // comptes par jour (toutes catégories confondues)

type Entry = { count: number; date: string };
type Store = Record<string, Entry>;

function today(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function load(): Store {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Store;
  } catch {
    return {};
  }
}

function save(store: Store): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function getEntry(userId: string): Entry {
  const store = load();
  const entry = store[userId];
  if (!entry || entry.date !== today()) return { count: 0, date: today() };
  return entry;
}

export function getLifetimeCount(userId: string): number {
  return getEntry(userId).count;
}

export function hasReachedLifetimeLimit(userId: string): boolean {
  return getEntry(userId).count >= LIFETIME_LIMIT;
}

export function incrementLifetime(userId: string): number {
  const store = load();
  const entry = store[userId];
  if (!entry || entry.date !== today()) {
    store[userId] = { count: 1, date: today() };
  } else {
    store[userId] = { count: entry.count + 1, date: today() };
  }
  save(store);
  return store[userId]!.count;
}

export function getLifetimeRemaining(userId: string): number {
  return Math.max(0, LIFETIME_LIMIT - getEntry(userId).count);
}
