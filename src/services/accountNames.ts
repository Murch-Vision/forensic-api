// Match stored account identifiers, never guess a bank from an account length.
export interface NamedAccount {
  accountNumber: string;
  iban?: string | null;
  accountHolderName: string | null;
}
const compact = (value: string) => value.replace(/\s+/g, "").toUpperCase();
export function realPartyName(value: string | null | undefined): string | null {
  const name = (value ?? "").trim();
  if (!name || /^(?:[-–—_.\s]*|unknown|n\/?a|null|undefined|тодорхойгүй)$/i.test(name)
    || /^(?:MN)?\d+$/i.test(compact(name))) return null;
  return name;
}
export function accountNameLookup(accounts: NamedAccount[]): (account: string | null | undefined) => string | null {
  const exact = new Map<string, string | null>();
  const legacy = new Map<string, string | null>();
  function add(map: Map<string, string | null>, key: string, name: string) {
    if (!key) return;
    if (!map.has(key)) map.set(key, name);
    else if (map.get(key)?.toUpperCase() !== name.toUpperCase()) map.set(key, null);
  }
  for (const account of accounts) {
    const name = realPartyName(account.accountHolderName);
    if (!name) continue;
    for (const raw of [account.accountNumber, account.iban]) {
      if (!raw) continue;
      const key = compact(raw);
      add(exact, key, name);
      const digits = /^MN\d{18}$/.test(key) ? key.slice(8) : /^\d+$/.test(key) ? key : null;
      if (digits) add(legacy, digits.replace(/^0+/, "") || "0", name);
    }
  }
  return (raw) => {
    if (!raw) return null;
    const key = compact(raw);
    if (exact.has(key)) return exact.get(key) ?? null;
    // Never match an unknown IBAN to a different bank by its account suffix.
    if (!/^\d+$/.test(key)) return null;
    return legacy.get(key.replace(/^0+/, "") || "0") ?? null;
  };
}
