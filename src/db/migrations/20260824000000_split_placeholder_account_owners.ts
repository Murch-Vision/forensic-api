import type {Knex} from "knex";

function isPlaceholder(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return !text || /^[-–—_.]+$/.test(text)
    || /^(unknown|null|n\/?a|тодорхойгүй)$/i.test(text);
}

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    const suspects = await trx("suspects").select("*");
    for (const suspect of suspects) {
      if (!isPlaceholder(suspect.fullName)
        || !isPlaceholder(suspect.nationalId)) continue;

      const accounts = await trx("bank_accounts")
        .where({suspectId: suspect.id}).orderBy("id", "asc");
      const realAccounts = accounts.filter(
        (account) => !isPlaceholder(account.accountNumber));
      if (realAccounts.length === 0) continue;

      const now = new Date().toISOString();
      const [first, ...rest] = realAccounts;
      await trx("suspects").where({id: suspect.id}).update({
        fullName: String(first.accountNumber),
        nationalId: null,
        updatedAt: now,
      });
      await trx("bank_accounts").where({id: first.id}).update({
        accountHolderName: String(first.accountNumber),
      });

      for (const account of rest) {
        const importedId = `IMP-SPLIT-${suspect.id}-${account.id}`;
        let split = await trx("suspects").where({suspectId: importedId}).first();
        if (!split) {
          const [id] = await trx("suspects").insert({
            suspectId: importedId,
            fullName: String(account.accountNumber),
            nationalId: null,
            riskLevel: suspect.riskLevel ?? "UNKNOWN",
            status: suspect.status ?? "ACTIVE",
            caseId: suspect.caseId ?? null,
            createdAt: now,
            updatedAt: now,
          });
          split = {id};
        }
        await trx("bank_accounts").where({id: account.id}).update({
          suspectId: Number(split.id),
          accountHolderName: String(account.accountNumber),
        });
      }

      // A placeholder account such as "-" is not a person's identity and
      // must not keep all otherwise separate people tied together.
      for (const account of accounts.filter(
        (item) => isPlaceholder(item.accountNumber))) {
        await trx("bank_accounts").where({id: account.id}).update({
          suspectId: null,
          accountHolderName: null,
        });
      }
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    const splits = await trx("suspects")
      .where("suspectId", "like", "IMP-SPLIT-%").select("id", "suspectId");
    const originals = new Set<number>();
    for (const split of splits) {
      const match = /^IMP-SPLIT-(\d+)-(\d+)$/.exec(String(split.suspectId));
      if (!match) continue;
      const originalId = Number(match[1]);
      originals.add(originalId);
      await trx("bank_accounts").where({suspectId: split.id}).update({
        suspectId: originalId,
        accountHolderName: null,
      });
      await trx("suspects").where({id: split.id}).delete();
    }
    for (const originalId of originals) {
      await trx("bank_accounts").whereNull("suspectId")
        .whereIn("accountNumber", ["-", "–", "—", "_"])
        .update({suspectId: originalId});
      await trx("suspects").where({id: originalId}).update({
        fullName: "-", nationalId: "-", updatedAt: new Date().toISOString(),
      });
    }
  });
}
