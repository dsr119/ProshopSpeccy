// Recently viewed customers, stored per signed-in user in this browser and
// cleared on sign out so the list never shows to the next person.

export interface RecentCustomer {
  id: string;
  name: string;
  phone: string | null;
  viewedAt: string;
}

const PREFIX = 'proshop:recent:';
const MAX = 8;

function read(userId: string): RecentCustomer[] {
  try {
    const raw = localStorage.getItem(PREFIX + userId);
    return raw ? (JSON.parse(raw) as RecentCustomer[]) : [];
  } catch {
    return [];
  }
}

export function getRecent(userId: string): RecentCustomer[] {
  return read(userId);
}

export function addRecent(userId: string, c: Omit<RecentCustomer, 'viewedAt'>) {
  const list = [{ ...c, viewedAt: new Date().toISOString() }, ...read(userId).filter((r) => r.id !== c.id)].slice(0, MAX);
  try {
    localStorage.setItem(PREFIX + userId, JSON.stringify(list));
  } catch {
    // Storage unavailable (private mode); the list is a convenience only.
  }
}

export function forgetRecent(userId: string, id: string) {
  try {
    localStorage.setItem(PREFIX + userId, JSON.stringify(read(userId).filter((r) => r.id !== id)));
  } catch {
    // ignore
  }
}

/** Removes every per-user convenience entry kept in this browser. */
export function clearLocalUserData() {
  try {
    for (const store of [localStorage, sessionStorage]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const key = store.key(i);
        if (key && key.startsWith('proshop:')) store.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}
