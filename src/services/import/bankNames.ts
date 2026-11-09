export interface BankNameSubject {id: number; fullName: string; nationalId: string | null; suspectId?: string}

export const cleanBankText = (raw: string | null | undefined): string | null => {
  const value = raw?.trim() ?? "";
  return !value || /^[-–—_.]+$/.test(value)
    || /^(unknown|null|n\/?a|тодорхойгүй)$/i.test(value) ? null : value;
};
export const bankNameKey = (raw: string | null | undefined): string =>
  (cleanBankText(raw) ?? "").normalize("NFKC").replace(/\s+/gu, " ").toUpperCase();

// Only registered subjects can supply a register. Re-imported anonymous
// account placeholders must not make an otherwise unique identity ambiguous.
export function bankNameIndex(subjects: BankNameSubject[]) {
  const index = new Map<string, BankNameSubject[]>();
  for (const subject of subjects) {
    const name = bankNameKey(subject.fullName);
    const nationalId = cleanBankText(subject.nationalId)?.toUpperCase();
    if (!name || (!nationalId && subject.suspectId?.startsWith("IMP-ACCOUNT-"))) continue;
    const list = index.get(name) ?? [];
    list.push({...subject, nationalId: nationalId ?? null}); index.set(name, list);
  }
  return index;
}

export function chooseBankName(primary: string | null, secondary: string | null,
  register: string | null, index: ReturnType<typeof bankNameIndex>) {
  const nationalId = cleanBankText(register)?.toUpperCase() ?? null;
  const names = [cleanBankText(primary), cleanBankText(secondary)];
  let ambiguous = false;
  for (const [position, name] of names.entries()) {
    if (!name) continue;
    const matches = index.get(bankNameKey(name)) ?? [];
    const registered = matches.filter(s => s.nationalId);
    const registers = new Set(registered.map(s => s.nationalId));
    if (registers.size > 1 && !nationalId) {ambiguous = true; continue;}
    const subject = registered.find(s => !nationalId || s.nationalId === nationalId);
    if (subject) return {name, nationalId: nationalId ?? subject.nationalId,
      subject, inferred: !nationalId, secondary: position === 1, ambiguous: false};
    if (!nationalId && !registered.length && matches.length) return {name,
      nationalId: null, subject: undefined, inferred: false, secondary: position === 1, ambiguous: false};
  }
  return {name: names[0] ?? names[1], nationalId, subject: undefined,
    inferred: false, secondary: !names[0] && !!names[1], ambiguous};
}
