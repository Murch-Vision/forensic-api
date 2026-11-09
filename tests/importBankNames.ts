// npx tsx tests/importBankNames.ts — isolated test DB; no live case writes.
import assert from "node:assert/strict";
import path from "node:path";
import knex from "knex";
import {ImportService} from "../src/services/importService";
import {bankNameIndex, chooseBankName} from "../src/services/import/bankNames";

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
    // Bank transit labels must use the selected second name independently
    // of whether that person is already a registered case subject.
    const transitIndex=bankNameIndex([{id:99999,fullName:"Авизын түр данс",nationalId:"ЗЗ12345678"}]);
    assert.equal(chooseBankName("Авизын түр данс","ШИНЭ ХҮН",null,transitIndex).name,"ШИНЭ ХҮН");
    assert.equal(chooseBankName("Авизын түр данс",null,null,transitIndex).nationalId,null,
      'A bank transit label cannot supply a human register');
    assert.equal(chooseBankName("ЖИНХЭНЭ НЭР","Авизын түр данс",null,transitIndex).name,"ЖИНХЭНЭ НЭР");
    const transitLines=[
      "2026-09-10,1001,,,11,7001,Авизын түр данс,ШИНЭ ХАРИЛЦАГЧ,,AVIS-NEW",
      "2026-09-11,1001,,,12,7002,  аВиЗыН  түр данс (MNT),САРАН БОЛД,,AVIS-SUBJECT",
      "2026-09-12,1001,,,13,7003,Авизын түр данс,,,AVIS-EMPTY",
      "2026-09-13,1001,,,14,7004,Авизын түр данс,БҮРТГЭЛТЭЙ ШИНЭ ХҮН,КК12345678,AVIS-REGISTER",
    ];
    assert.equal((await run(transitLines)).importedRows,4);
    const transitAccount=await db("bank_accounts").where({accountNumber:"7001"}).first();
    assert.equal(transitAccount.accountHolderName,"ШИНЭ ХАРИЛЦАГЧ");
    assert.equal((await db("suspects").where({id:transitAccount.suspectId}).first()).fullName,"ШИНЭ ХАРИЛЦАГЧ");
    const transitNew=await db("bank_transactions").where({referenceNumber:"AVIS-NEW"}).first();
    assert.equal(transitNew.counterpartyName,"ШИНЭ ХАРИЛЦАГЧ");
    assert.equal(transitNew.counterpartyNationalId,null,'Using name 2 does not invent a register');
    assert.equal((await db("bank_accounts").where({accountNumber:"7002"}).first()).suspectId,b);
    assert.equal((await db("bank_transactions").where({referenceNumber:"AVIS-SUBJECT"}).first()).counterpartyNationalId,"ББ12345678");
    assert.equal((await db("bank_transactions").where({referenceNumber:"AVIS-EMPTY"}).first()).counterpartyName,"Авизын түр данс");
    assert.equal((await db("bank_transactions").where({referenceNumber:"AVIS-REGISTER"}).first()).counterpartyNationalId,"КК12345678");
    const disabledTransit="2026-09-14,1001,,,15,7005,Авизын түр данс,СОНГОГДООГҮЙ НЭР,,AVIS-DISABLED";
    await run([disabledTransit],caseId,{...mapping,counterpartyName2:""});
    assert.equal((await db("bank_transactions").where({referenceNumber:"AVIS-DISABLED"}).first()).counterpartyName,"Авизын түр данс");

    const repairTransit=async (number:string,register:string,map=mapping) => {
      const line=`2026-09-15,1001,,,16,${number},Авизын түр данс,ӨМНӨ БҮРТГЭГДЭЭГҮЙ НЭР,${register},AVIS-REPAIR-${number}`;
      await run([line],caseId,{...map,counterpartyName2:""});
      const before=await db("bank_transactions").where({counterpartyAccount:number}).orderBy("id");
      const accountBefore=await db("bank_accounts").where({accountNumber:number}).first();
      const subjectCount=(await db("suspects").count({n:"id"}).first())?.n;
      const result=await run([line],caseId,map);
      assert.equal(result.importedRows,0);assert.equal(result.duplicateRows,1);
      const after=await db("bank_transactions").where({counterpartyAccount:number}).orderBy("id");
      assert.equal(after.length,before.length);assert.equal(after[0].id,before[0].id);
      assert.equal(after[0].amount,before[0].amount);
      assert.equal(after[0].counterpartyName,"ӨМНӨ БҮРТГЭГДЭЭГҮЙ НЭР");
      assert.equal(after[0].counterpartyNationalId,register||null);
      const accountAfter=await db("bank_accounts").where({id:accountBefore.id}).first();
      assert.equal(accountAfter.suspectId,accountBefore.suspectId);
      assert.equal(accountAfter.accountHolderName,"ӨМНӨ БҮРТГЭГДЭЭГҮЙ НЭР");
      assert.equal((await db("suspects").where({id:accountAfter.suspectId}).first()).fullName,"ӨМНӨ БҮРТГЭГДЭЭГҮЙ НЭР");
      assert.equal((await db("suspects").count({n:"id"}).first())?.n,subjectCount);
      assert.equal((await run([line],caseId,map)).duplicateRows,1,'Repair is idempotent');
    };
    await repairTransit("7101","");
    await repairTransit("7102","ЛЛ12345678");
    await repairTransit("7103","",noRef);

    const verifiedLabelLine="2026-09-16,1001,,,17,7200,Авизын түр данс,ӨӨР НЭР,,AVIS-LABEL";
    await run([verifiedLabelLine],caseId,{...mapping,counterpartyName2:""});
    const verifiedLabel=await db("bank_accounts").where({accountNumber:"7200"}).first();
    await db("bank_accounts").where({id:verifiedLabel.id}).update({accountHolderName:"БАТАЛСАН ДАНСНЫ НЭР"});
    await run([verifiedLabelLine]);
    assert.equal((await db("bank_accounts").where({id:verifiedLabel.id}).first()).accountHolderName,"БАТАЛСАН ДАНСНЫ НЭР");
    assert.equal((await db("suspects").where({id:verifiedLabel.suspectId}).first()).fullName,"Авизын түр данс",
      'A verified account name also protects the existing owner');
    const sharedOwnerLine="2026-09-16,1001,,,17,7301,Авизын түр данс,ДАНСНЫ НЭР 2,,AVIS-SHARED";
    await run([sharedOwnerLine],caseId,{...mapping,counterpartyName2:""});
    const sharedOwner=await db("bank_accounts").where({accountNumber:"7301"}).first();
    await db("bank_accounts").insert({accountNumber:"7302",suspectId:sharedOwner.suspectId,
      accountHolderName:"БУСАД ДАНСНЫ НЭР",createdAt:now});
    await run([sharedOwnerLine]);
    assert.equal((await db("suspects").where({id:sharedOwner.suspectId}).first()).fullName,"Авизын түр данс",
      'An unregistered owner shared manually with another account cannot be renamed by one statement');
    assert.equal((await db("bank_accounts").where({accountNumber:"7302"}).first()).accountHolderName,"БУСАД ДАНСНЫ НЭР");
    const manualTransit=await person("MANUAL-TRANSIT","Авизын түр данс",null);
    await db("bank_accounts").insert({accountNumber:"7201",suspectId:manualTransit,
      accountHolderName:"ГАРААР БАТАЛСАН ЭЗЭМШИГЧ",createdAt:now});
    await run(["2026-09-16,1001,,,17,7201,Авизын түр данс,ШИНЭ НЭР,,AVIS-MANUAL"]);
    assert.equal((await db("suspects").where({id:manualTransit}).first()).fullName,"Авизын түр данс");
    assert.equal((await db("bank_accounts").where({accountNumber:"7201"}).first()).accountHolderName,"ГАРААР БАТАЛСАН ЭЗЭМШИГЧ");
    await run(["2026-09-17,1001,,,18,2001,Авизын түр данс,ШИНЭ НЭР,,AVIS-PROTECTED"]);
    assert.equal((await db("bank_accounts").where({accountNumber:"2001"}).first()).suspectId,b);
    assert.equal((await db("suspects").where({id:b}).first()).fullName,"САРАН БОЛД");
    console.log("PASS: alternate bank names, primary priority, scoped registers, homonyms, explicit/verified identities, exact duplicate repair, Aviz transit-name fallback without subject matches, and protected owners");
  } finally {await db.destroy();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
