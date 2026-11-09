// npx tsx tests/importBankNames.ts — isolated test DB; no live case writes.
import assert from "node:assert/strict";
import path from "node:path";
import knex from "knex";
import {ImportService} from "../src/services/importService";

async function main() {
  const db = knex({client: "better-sqlite3", connection: {filename: ":memory:"}, useNullAsDefault: true});
  try {
    await db.migrate.latest({directory: path.resolve(__dirname, "../src/db/migrations"), loadExtensions: [".ts"]});
    const now = new Date().toISOString();
    const [caseId] = await db("case_files").insert({caseId:"NAME-A",caseName:"A",createdAt:now,updatedAt:now});
    await db("case_files").insert({caseId:"NAME-B",caseName:"B",createdAt:now,updatedAt:now});
    const person = async (key: string, name: string, reg: string | null, scope = "NAME-A") => {
      const [id] = await db("suspects").insert({suspectId:key,fullName:name,nationalId:reg,
        caseId:scope,riskLevel:"UNKNOWN",status:"ACTIVE",createdAt:now,updatedAt:now});
      return Number(id);
    };
    const a = await person("SUB-A","БАТ ДОРЖ","АА12345678");
    const b = await person("SUB-B","САРАН БОЛД","ББ12345678","NAME-B");
    await db("evidence_entries").insert({caseFileId:caseId,sourceType:"SUSPECT",sourceId:b,
      description:"Registered subject",exhibitNumber:1,taggedAtUtc:now});
    await person("AMB-A","ИЖИЛ НЭР","ВВ12345678");
    await person("AMB-B","ИЖИЛ НЭР","ГГ12345678");
    await person("OTHER-CASE","БУСАД ХЭРЭГ","ДД12345678","NAME-B");
    await person("UNREGISTERED","РЕГИСТРГҮЙ СУБЪЕКТ",null);
    const imports = new ImportService(db);
    const mapping = {date:"date",account:"account",ownerName:"owner",nationalId:"ownerRegister",
      amount:"amount",counterpartyAccount:"party",counterpartyName:"first",counterpartyName2:"second",
      counterpartyNationalId:"register",reference:"ref"};
    const header = "date,account,owner,ownerRegister,amount,party,first,second,register,ref";
    const run = (lines: string[], useCase: number | undefined = caseId, map = mapping) => imports.importData({
      content:[header,...lines].join("\n"),kind:"BANK",filename:"names.csv",mapping:map,caseFileId:useCase});
    const content = [
      "2026-11-01,1001, бат   дорж ,,-100,2001,Банкны өөр нэр,САРАН БОЛД,,R1",
      "2026-11-02,1001,,,200,2002,БАТ ДОРЖ,САРАН БОЛД,,R2",
      "2026-11-03,1001,,,300,2003,,ЗӨВХӨН ХОЁР ДАХЬ,,R3",
      "2026-11-04,1001,,,400,2004,ИЖИЛ НЭР,,,R4",
      "2026-11-05,1001,,,500,2005,БУСАД ХЭРЭГ,,,R5",
      "2026-11-06,1001,,,600,2006,САРАН БОЛД,БАТ ДОРЖ,АА12345678,R6",
      "2026-11-07,1001,,,700,2007,ӨӨР НЭР,САРАН БОЛД,ЕЕ12345678,R7",
      "2026-11-08,1001,,,800,2008,Таарахгүй нэр,РЕГИСТРГҮЙ СУБЪЕКТ,,R8",
      "2026-11-09,1001,,,900,2009,ИЖИЛ НЭР,САРАН БОЛД,,R9",
    ];
    const result = await run(content);
    assert.equal(result.importedRows,9); assert.deepEqual(result.errors,[]);
    const accounts = await db("bank_accounts");
    const account = (n: string) => accounts.find(r=>r.accountNumber===n)!;
    assert.equal(account("1001").suspectId,a,'Statement owner also inherits the matching subject register');
    assert.equal(account("2001").suspectId,b,'Evidence-tagged subject is a valid case name match');
    assert.equal(account("2001").accountHolderName,"САРАН БОЛД");
    assert.equal(account("2002").suspectId,a,'Primary name wins when both match different subjects');
    const txns = await db("bank_transactions").orderBy("id");
    assert.equal(txns[0].counterpartyName,"САРАН БОЛД");
    assert.equal(txns[0].counterpartyNationalId,"ББ12345678");
    assert.equal(txns[2].counterpartyName,"ЗӨВХӨН ХОЁР ДАХЬ");
    assert.equal(txns[3].counterpartyNationalId,null,'Homonyms with distinct registers are ambiguous');
    assert.equal(txns[4].counterpartyNationalId,null,'Another case cannot supply a register by name');
    assert.equal(txns[5].counterpartyName,"БАТ ДОРЖ",'Explicit register disambiguates the two names');
    assert.equal(txns[5].counterpartyNationalId,"АА12345678");
    assert.equal(txns[6].counterpartyNationalId,"ЕЕ12345678",'File register is never replaced by name inference');
    assert.equal(txns[7].counterpartyName,"РЕГИСТРГҮЙ СУБЪЕКТ");
    assert.equal(txns[7].counterpartyNationalId,null);
    assert.equal(txns[8].counterpartyNationalId,"ББ12345678",'A unique secondary match resolves an ambiguous primary');
    assert(result.messages.some(m=>m.includes('олон өөр регистр')));

    // Re-map a duplicate-only old import. Repair only its exact source rows;
    // keep transaction IDs, money, historical people and other accounts.
    const oldLine = "2026-10-01,1001,,,100,3001,Өмнөх буруу нэр,САРАН БОЛД,,REPAIR";
    await run([oldLine],caseId,{...mapping,counterpartyName2:""});
    const old = await db("bank_transactions").where({referenceNumber:"REPAIR"}).first();
    const oldAccount = await db("bank_accounts").where({accountNumber:"3001"}).first();
    const [unrelatedId] = await db("bank_accounts").insert({accountNumber:"3002",suspectId:oldAccount.suspectId,
      accountHolderName:"Preserve other account",createdAt:now});
    const repaired = await run([oldLine]);
    assert.equal(repaired.importedRows,0); assert.equal(repaired.duplicateRows,1);
    const repairedTxn = await db("bank_transactions").where({id:old.id}).first();
    assert.equal(repairedTxn.counterpartyName,"САРАН БОЛД");
    assert.equal(repairedTxn.counterpartyNationalId,"ББ12345678");
    assert.equal(repairedTxn.amount,old.amount);
    assert.equal((await db("bank_accounts").where({id:oldAccount.id}).first()).suspectId,b);
    assert.equal((await db("bank_accounts").where({id:unrelatedId}).first()).suspectId,oldAccount.suspectId);
    assert(await db("suspects").where({id:oldAccount.suspectId}).first(),'Historical placeholder is not deleted');
    assert.equal((await run([oldLine])).duplicateRows,1);
    await db("bank_transactions").where({id:old.id}).update({counterpartyName:"Verified row name",counterpartyNationalId:"ЖЖ12345678"});
    assert.equal((await run([oldLine])).duplicateRows,1);
    const protectedRow = await db("bank_transactions").where({id:old.id}).first();
    assert.equal(protectedRow.counterpartyNationalId,"ЖЖ12345678");
    assert.equal(protectedRow.counterpartyName,"Verified row name",'Name repair cannot contradict a previously known row register');

    // The fingerprint path repairs names/registers too; genuine identical
    // rows in one file must still be retained as separate source transactions.
    const noRef = {...mapping,reference:""};
    const exact = "2026-10-02,1001,,,123,4001,Өмнөх нэр,САРАН БОЛД,,";
    await run([exact,exact],caseId,{...noRef,counterpartyName2:""});
    const duplicates = await run([exact,exact],caseId,noRef);
    assert.equal(duplicates.duplicateRows,2); assert.equal(duplicates.importedRows,0);
    const repairedCopies = await db("bank_transactions").where({counterpartyAccount:"4001"});
    assert.equal(repairedCopies.length,2);
    assert(repairedCopies.every(r=>r.counterpartyNationalId==="ББ12345678" && r.counterpartyName==="САРАН БОЛД"));

    // Existing registered ownership takes precedence over inferred identities.
    const protectedLine = "2026-10-03,1001,,,20,2002,Өөр нэр,САРАН БОЛД,,PROTECTED";
    const protectedResult = await run([protectedLine]);
    assert.equal((await db("bank_accounts").where({id:account("2002").id}).first()).suspectId,a);
    assert.equal((await db("bank_transactions").where({referenceNumber:"PROTECTED"}).first()).counterpartyNationalId,null);
    assert(protectedResult.messages.some(m=>m.includes('зөрсөн')));
    const count = await db("bank_transactions").count({n:"id"}).first();
    await run([oldLine.replace("3001","9999")]);
    assert.equal((await db("bank_transactions").count({n:"id"}).first())?.n,count?.n,
      'Duplicate reference with another account cannot rewrite the old transaction');
    assert.equal((await db("bank_transactions").where({id:old.id}).first()).counterpartyAccount,"3001");

    const unscoped = await imports.importData({content:[header,
      "2026-10-04,1001,,,50,5001,Өөр нэр,САРАН БОЛД,,UNSCOPED"].join("\n"),kind:"BANK",mapping});
    assert.equal(unscoped.importedRows,1);
    assert.equal((await db("bank_transactions").where({referenceNumber:"UNSCOPED"}).first()).counterpartyNationalId,null);
    const preview = imports.preview("Гүйлгээний огноо,Гүйлгээний дүн,Харьцсан харилцагчийн нэр 2\n2026-11-01,10,САРАН БОЛД");
    assert(preview.mapping.some(m=>m.field==="counterpartyName2"));
    const autoHeader = "Гүйлгээний огноо,Гүйлгээний дүн,Харьцсан данс,Харьцсан харилцагчийн нэр,Харьцсан харилцагчийн нэр 2";
    await imports.importData({content:autoHeader+"\n2026-09-01,70,6001,Өөр нэр,САРАН БОЛД",
      kind:"BANK",caseFileId:caseId,mapping:{counterpartyName2:""}});
    const disabled = await db("bank_transactions").where({counterpartyAccount:"6001"}).first();
    assert.equal(disabled.counterpartyName,"Өөр нэр");
    assert.equal(disabled.counterpartyNationalId,null,'An explicitly cleared optional column overrides auto-detection');
    console.log("PASS: alternate bank names, primary priority, scoped registers, homonyms, explicit/verified identities, exact duplicate repair and account isolation");
  } finally {await db.destroy();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
