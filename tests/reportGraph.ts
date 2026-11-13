// npx tsx tests/reportGraph.ts
// Real PNG validation and PDF/Word/HTML generation. Resolver service doubles;
// all files stay in memory and no application database is changed.
import assert from "node:assert/strict";
import sharp from "sharp";
import {randomBytes} from "node:crypto";
import {REPORT_ANALYSIS_BYTES, REPORT_IMAGE_BYTES, base64Length} from "../src/services/reportGraphLimits";
import JSZip from "jszip";
import {buildSchema, parse, validate} from "graphql";
import {prepareReportGraph} from "../src/services/reportGraph";
import {ReportService, type VerdictInput} from "../src/services/reportService";
import {resolvers, type GraphQLContext} from "../src/graphql/resolvers";
import {typeDefs} from "../src/graphql/schema";
import {beginGraphUpload, appendGraphUpload, takeGraphUpload, releaseGraphUpload}
  from "../src/services/reportGraphUpload";
import PDFDocument from "pdfkit";

async function main() {
  const png = await sharp(Buffer.from('<svg width="160" height="80"><rect width="160" height="80" fill="#0b0e1a"/><path d="M20 40H140" stroke="#00e676"/><circle cx="20" cy="40" r="9" fill="red"/><circle cx="140" cy="40" r="9" fill="green"/></svg>')).png().toBuffer();
  const graphInput = {caseFileId: 1, title: 'Холбоос <script> & "тест"', imageBase64: png.toString('base64')};
  const graph = await prepareReportGraph(graphInput);
  const staged = beginGraphUpload(1,1);
  appendGraphUpload(staged,1,0,'AAAA');
  assert.throws(()=>appendGraphUpload(staged,2,4,'AAAA'));
  assert.throws(()=>appendGraphUpload(staged,1,0,'AAAA'), /буруу/);
  assert.throws(()=>appendGraphUpload(staged,1,4,'A'.repeat(512001)), /том/);
  assert.throws(()=>takeGraphUpload(staged,1,2), /өөр хэрэг/);
  assert.throws(()=>releaseGraphUpload(staged,2), /эрхгүй/);
  assert.equal(takeGraphUpload(staged,1,1),'AAAA');
  assert.throws(()=>takeGraphUpload(staged,1,1));
  const abandoned=beginGraphUpload(1,1), clock=Date.now;
  try {Date.now=()=>clock()+121000;assert.throws(()=>takeGraphUpload(abandoned,1,1));}
  finally {Date.now=clock;}
  assert.equal(graph.width, 160); assert.equal(graph.height, 80);
  for (const imageBase64 of ['', 'data:image/png;base64,abc', 'not PNG!', png.subarray(0, 40).toString('base64'), 'A'.repeat(12_000_000)]) {
    await assert.rejects(prepareReportGraph({...graphInput, imageBase64}));
  }
  const large = await sharp({create:{width: 4097,height: 1,channels: 3,background: 'white'}}).png().toBuffer();
  await assert.rejects(prepareReportGraph({...graphInput, imageBase64: large.toString('base64')}), /PNG/);
  const input: VerdictInput = {caseId: 'QA', caseName: 'Тест', period: {from: null, to: null},
    analyses: [], mutualRelations: [], transfers: [], conclusions: [], graph};
  const service = new ReportService({} as any);
  const html = (await service.generateVerdictHtml(input)).toString('utf8');
  assert(html.includes('2.2 ХОЛБООСЫН ЗУРАГЛАЛ'));
  assert(html.includes(`data:image/png;base64,${graph.imageBase64}`));
  assert(!html.includes('<script>')); assert(html.includes('&lt;script&gt;'));
  const pdf = (await service.generateVerdictPdf(input)).toString('latin1');
  assert(pdf.startsWith('%PDF-'));
  assert.equal((pdf.match(/\/Subtype \/Image/g) ?? []).length, 1);
  const pages = [...pdf.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(m => m[1].split(' ').map(Number));
  assert(pages.some(p => p[2] > p[3]), 'Graph must have a landscape page');
  assert(pages.at(-1)![2] < pages.at(-1)![3], 'Conclusions must return to portrait');
  const docx = await JSZip.loadAsync(await service.generateVerdictDocx(input));
  const images = Object.values(docx.files).filter(f => /^word\/media\//.test(f.name) && !f.dir);
  assert.equal(images.length, 1, 'Word must embed pixels, not a remote link');
  assert.equal((await sharp(await images[0].async('nodebuffer')).metadata()).width, graph.width);
  assert((await docx.file('word/document.xml')!.async('string')).includes('2.2 ХОЛБООСЫН ЗУРАГЛАЛ'));
  const mainXml = await docx.file('word/document.xml')!.async('string');
  assert(mainXml.includes('<wp:extent cx="9664700" cy="4832350"'),
    'Word image fits the landscape body and preserves aspect ratio');
  assert(mainXml.includes('w:w="16838" w:h="11906" w:orient="landscape"'));
  assert(!mainXml.includes('FORENSIC_GRAPH_PAGE_'));
  assert(/<w:sectPr>\s*<w:pgSz[^>]*w:orient="portrait"[\s\S]*?<\/w:sectPr><\/w:body>/.test(mainXml),
    'The final portrait section properties are last in the Word body');
  const plain = {...input, graph: undefined};
  assert(!(await service.generateVerdictHtml(plain)).toString().includes('data:image/png'));
  assert(!(await service.generateVerdictPdf(plain)).toString('latin1').includes('/Subtype /Image'));
  const analysisRaw = {version:1, flowImages:[{imageBase64:png.toString('base64')}], flow:Array.from({length:67},(_,i)=>({
    from:`Эх үүсвэр ${i}`,to:`Харилцагч ${i}`,amount:100+i,directed:i!==66,soft:i===66,
    fromRed:false,toRed:i===66})),
    shared:{rows:Array.from({length:67},(_,i)=>[`ДУНДЫН-${i}`,`Хүн А ↔ Хүн Б ${i}`,'1 дамжлага',`${i} гүйлгээ`]),
      amounts:Array.from({length:67},(_,i)=>i*100),
      image:{imageBase64:png.toString('base64')}},
    red:{rows:[['ХЭРЭГТЭН · Тест','Харилцагч',('Урт тэмдэглэл '.repeat(150))+'LAST-NOTE']],
      image:{imageBase64:png.toString('base64')}}};
  const encoded=Buffer.from(JSON.stringify(analysisRaw)).toString('base64');
  const withAnalysis=await prepareReportGraph({...graphInput,analysisBase64:encoded});
  assert.equal(withAnalysis.analysis?.flow.length,67);
  assert.equal(withAnalysis.analysis?.shared.rows.length,20);
  assert.deepEqual(withAnalysis.analysis?.shared.amounts,Array.from({length:20},(_,i)=>(66-i)*100));
  assert.equal(withAnalysis.analysis?.shared.rows[0][0],'ДУНДЫН-66');
  assert.equal(withAnalysis.analysis?.shared.rows.at(-1)?.[0],'ДУНДЫН-47');
  const noMoneyImage=await prepareReportGraph({...graphInput,
    analysisBase64:Buffer.from(JSON.stringify({...analysisRaw,flowImages:[]})).toString('base64')});
  assert.equal(noMoneyImage.analysis?.flowImages.length,0,'New captures need no money PNG');
  const legacyRaw={...analysisRaw,shared:{...analysisRaw.shared,amounts:undefined,
    rows:analysisRaw.shared.rows.map((r,i)=>[...r.slice(0,3),`${(i*1000).toLocaleString('en-US')}₮ · 2 гүйлгээ`])}};
  const legacy=await prepareReportGraph({...graphInput,analysisBase64:Buffer.from(JSON.stringify(legacyRaw)).toString('base64')});
  assert.equal(legacy.analysis?.shared.rows[0][0],'ДУНДЫН-66','Old captures rank by formatted money');
  const isolatedRaw={...analysisRaw,red:{...analysisRaw.red,rows:[]}};
  const isolated=await prepareReportGraph({...graphInput,analysisBase64:Buffer.from(JSON.stringify(isolatedRaw)).toString('base64')});
  assert(isolated.analysis?.red.image,'Isolated offenders can have a diagram without relationship rows');
  for(const bad of [{...analysisRaw,version:2},
    {...analysisRaw,flowImages:[analysisRaw.flowImages[0],analysisRaw.flowImages[0]]},
    {...analysisRaw,flowImages:[{imageBase64:'bad PNG'}]},{...analysisRaw,flow:[{...analysisRaw.flow[0],amount:-1}]},
    {...analysisRaw,flow:[{...analysisRaw.flow[0],soft:true}]},
    ...[[],[-1],['100'],Array(67).fill(-1)].map(amounts=>({...analysisRaw,shared:{...analysisRaw.shared,amounts}})),
    {...analysisRaw,shared:{rows:[['broken']]}},
    {...analysisRaw,red:{rows:[['a','b','c']],image:{imageBase64:'not PNG'}}}]) {
    await assert.rejects(prepareReportGraph({...graphInput,analysisBase64:Buffer.from(JSON.stringify(bad)).toString('base64')}));
  }
  const noisy = await sharp(randomBytes(1450*1450*3),{raw:{width:1450,height:1450,channels:3}}).png().toBuffer();
  assert(noisy.length < REPORT_IMAGE_BYTES);
  const bigRaw={...analysisRaw,flowImages:[{imageBase64:noisy.toString('base64')}],
    shared:{...analysisRaw.shared,image:{imageBase64:noisy.toString('base64')}},
    red:{...analysisRaw.red,image:{imageBase64:noisy.toString('base64')}}};
  const bigBytes=Buffer.from(JSON.stringify(bigRaw)), bigEncoded=bigBytes.toString('base64');
  assert(bigBytes.length>REPORT_IMAGE_BYTES && bigBytes.length<REPORT_ANALYSIS_BYTES);
  const bigStage=beginGraphUpload(1,1,"ANALYSIS");
  for(let offset=0;offset<bigEncoded.length;offset+=480000)
    appendGraphUpload(bigStage,1,offset,bigEncoded.slice(offset,offset+480000));
  const bigGraph=await prepareReportGraph({...graphInput,analysisBase64:takeGraphUpload(bigStage,1,1)});
  assert.equal(bigGraph.analysis?.flowImages[0].width,1450,
    'Multi-image JSON above the old single-PNG quota is transported and validated');
  assert.throws(()=>takeGraphUpload(bigStage,1,1));
  for(const [kind,limit] of [["IMAGE",REPORT_IMAGE_BYTES],["ANALYSIS",REPORT_ANALYSIS_BYTES]] as const) {
    const id=beginGraphUpload(1,1,kind);
    const cap=base64Length(limit);
    let offset=0;
    while(offset<cap){const chunk='A'.repeat(Math.min(512000,cap-offset));appendGraphUpload(id,1,offset,chunk);offset+=chunk.length;}
    assert.throws(()=>appendGraphUpload(id,1,offset,'AAAA'),/том/, `${kind} remains bounded`);
    releaseGraphUpload(id,1);
  }
  for(const invalid of ['not base64','e30=','A'.repeat(12000000)])
    await assert.rejects(prepareReportGraph({...graphInput,analysisBase64:invalid}));
  // Older captures may include a tall money image. Validate it for v1
  // compatibility, but never embed it or allocate a page for it.
  const tallPng=await sharp({create:{width:1000,height:6000,channels:3,background:'#122538'}}).png().toBuffer();
  const tallRaw={...analysisRaw,flowImages:[{imageBase64:tallPng.toString('base64')}]};
  const tallGraph=await prepareReportGraph({...graphInput,analysisBase64:Buffer.from(JSON.stringify(tallRaw)).toString('base64')});
  assert.equal(tallGraph.analysis?.flowImages.length,1);
  assert.equal(tallGraph.analysis?.flowImages[0].height,6000);
  await assert.rejects(prepareReportGraph({...graphInput,imageBase64:tallPng.toString('base64')}),
    /PNG/, 'The main chart retains its original dimension limits');
  const tooTall=await sharp({create:{width:8,height:16001,channels:3,background:'#123456'}}).png().toBuffer();
  for(const bad of [{...tallRaw,flowImages:[{imageBase64:tooTall.toString('base64')}]},
    {...analysisRaw,shared:{...analysisRaw.shared,image:{imageBase64:tallPng.toString('base64')}}}]) {
    await assert.rejects(prepareReportGraph({...graphInput,analysisBase64:Buffer.from(JSON.stringify(bad)).toString('base64')}),
      /PNG/, 'Tall overview allowances do not bypass height limits or widen relation image limits');
  }
  const tallHtml=(await service.generateVerdictHtml({...input,graph:tallGraph})).toString();
  assert(!tallHtml.includes('report-money-flow'),'Money section is omitted even for old captures');
  assert(!tallHtml.includes(tallGraph.analysis!.flowImages[0].imageBase64),
    'Legacy money PNG bytes are excluded from the HTML');
  const tallPdf=await service.generateVerdictPdf({...input,graph:tallGraph});
  const boxes=[...tallPdf.toString('latin1').matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
  assert.equal(boxes.filter(box=>Number(box[1])>Number(box[2])).length,3,'Main/shared/offender images each have one landscape page');
  assert(boxes.every(box=>Number(box[1])<=842&&Number(box[2])<=842),'Only ordinary A4 pages, no oversized money page');
  const tallWord=await JSZip.loadAsync(await service.generateVerdictDocx({...input,graph:tallGraph}));
  const tallXml=await tallWord.file('word/document.xml')!.async('string');
  const extents=[...tallXml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
  assert.equal(extents.length,3,'Word keeps main/shared/offender images only');
  assert(extents.every(e=>Number(e[2])<=415*12700),'The complete image fits on a Word page without cropping');
  assert.equal((tallXml.match(/w:orient="landscape"/g)||[]).length,3);
  assert.equal((tallXml.match(/w:type w:val="nextPage"/g)||[]).length,5,
    'Adjacent landscape images have no empty portrait section between them');
  assert(extents.every(e=>Number(e[1])<=761*12700));
  assert(tallHtml.includes('@page graph { size: A4 landscape;'));
  assert.equal((tallHtml.match(/class="report-graph-page"/g)||[]).length,3);
  const media=await Promise.all(Object.values(tallWord.files).filter(f=>/^word\/media\/.*\.png$/.test(f.name))
    .map(async f=>sharp(await f.async('nodebuffer')).metadata()));
  assert(!media.some(m=>m.width===1000&&m.height===6000),'Legacy money PNG is not embedded in Word');
  if(process.env.REPORT_TEST_OUTPUT){
    const {writeFile}=await import('node:fs/promises');
    await writeFile(`${process.env.REPORT_TEST_OUTPUT}-tall.html`,tallHtml);
    await writeFile(`${process.env.REPORT_TEST_OUTPUT}-tall.docx`,await service.generateVerdictDocx({...input,graph:tallGraph}));
  }
  const mutualRelations=Array.from({length:37},(_,i)=>({key:`canonical-${i}`,name:`CANONICAL_${i}_END`,
    account:null,nationalId:null,txnCount:2,creditCount:1,debitCount:1,creditTotal:i*1000,
    debitTotal:(36-i)*500,netTotal:0,accountIds:[1,2],mutual:true,subjectMatch:false}));
  const complete={...input,mutualRelations,graph:withAnalysis,transfers:[{
    fromAccountId:1,toAccountId:2,fromLabel:'FROM-ACCOUNT',toLabel:'TO-ACCOUNT',txnCount:5,total:123456,
  }]};
  const completeHtml=(await service.generateVerdictHtml(complete)).toString();
  for(const title of ['2.2 ХОЛБООСЫН ЗУРАГЛАЛ','2.3 ДУНДЫН ХАРИЛЦАА','2.4 УЛААНААР ТЭМДЭГЛЭСЭН ЭТГЭЭДИЙН ХАРИЛЦАА'])
    assert(completeHtml.includes(title));
  assert(completeHtml.includes('ДУНДЫН-66')&&completeHtml.includes('LAST-NOTE'));
  assert(!completeHtml.includes('Харилцагч 66'),'Money rows are not repeated as a long report list');
  assert(!completeHtml.includes('report-flow-diagram'),'No native money-flow diagrams are rendered');
  const sharedStart=completeHtml.indexOf('2.3 ДУНДЫН ХАРИЛЦАА');
  const redStart=completeHtml.indexOf('2.4 УЛААНААР ТЭМДЭГЛЭСЭН ЭТГЭЭДИЙН ХАРИЛЦАА');
  assert(completeHtml.indexOf('data:image/png',sharedStart)<completeHtml.indexOf('ДУНДЫН-66',sharedStart));
  assert(completeHtml.indexOf('data:image/png',redStart)<completeHtml.indexOf('ХЭРЭГТЭН · Тест',redStart));
  const originalText=PDFDocument.prototype.text, originalImage=PDFDocument.prototype.image, printed:string[]=[];
  const imagePages = new Set<unknown>();
  let completePdf:Buffer;
  try {
    PDFDocument.prototype.image=function(...args:any[]){
      printed.push("IMAGE");
      assert(!imagePages.has(this.page),'Each graph occupies its own page');
      imagePages.add(this.page);
      assert(this.page.width>this.page.height,'Every graph page is landscape');
      const [,x,y,options]=args;
      assert(x>=40 && y>=40 && x+options.fit[0]<=this.page.width-40+0.01
        && y+options.fit[1]<=this.page.height-40+0.01,'The complete image fit box stays inside page margins');
      return (originalImage as any).apply(this,args);
    } as any;
    PDFDocument.prototype.text=function(value:any,...args:any[]){printed.push(String(value).replace(/\n/g,''));
      return (originalText as any).call(this,value,...args); } as any;
    completePdf=await service.generateVerdictPdf(complete);
  } finally {PDFDocument.prototype.text=originalText;PDFDocument.prototype.image=originalImage;}
  assert(printed.includes('ДУНДЫН-66')&&!printed.includes('Харилцагч 66'));
  for(const [title,first] of [['2.3 ДУНДЫН ХАРИЛЦАА · ДҮНГЭЭР ТОП 20','ДУНДЫН-66'],['2.4 УЛААНААР ТЭМДЭГЛЭСЭН ЭТГЭЭДИЙН ХАРИЛЦАА','ХЭРЭГТЭН · Тест']]) {
    const start=printed.findIndex(t=>t===title);
    assert(printed.indexOf('IMAGE',start)>start&&printed.indexOf('IMAGE',start)<printed.findIndex((t,i)=>i>start&&t.includes(first)),
      'PDF relation diagram precedes its table');
  }
  assert(printed.join('').includes('LAST-NOTE'),'Long wrapped notes survive PDF continuation pages');
  assert.equal((completePdf!.toString('latin1').match(/\/Subtype \/Image/g)||[]).length,3,
    'PDF includes main, shared and red scene pixels only');
  const completeWord=await JSZip.loadAsync(await service.generateVerdictDocx(complete));
  const wordXml=await completeWord.file('word/document.xml')!.async('string');
  assert(wordXml.includes('ДУНДЫН-66')&&wordXml.includes('LAST-NOTE')&&!wordXml.includes('Харилцагч 66'));
  assert.equal((wordXml.match(/<w:drawing>/g)||[]).length,3,'Word contains main, shared and red diagram images only');
  for(const output of [completeHtml,wordXml,printed.join('')]) {
    assert(!output.includes('МӨНГӨН УРСГАЛ'),'Money graph heading is absent');
    assert(!output.includes('ШИНЖИЛСЭН ДАНСНУУДЫН ХООРОНДЫН ШУУД ГҮЙЛГЭЭ'),
      'Direct transfer table and heading are absent');
    assert(!output.includes('Хаанаас'),'Direct transfer table columns are absent');
    const retained = [...new Set([...output.matchAll(/ДУНДЫН-(\d+)/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
    assert.deepEqual(retained,Array.from({length:20},(_,i)=>47+i),'Exactly the highest20 attached contacts survive');
    for(let i=0;i<37;i++) assert.equal(output.includes(`CANONICAL_${i}_END`),i>=17,
      `Canonical shared list ranks credit plus debit: ${i}`);
    assert(output.includes('37 харилцагч'),'Conclusion still uses the full population');
  }
  assert.equal(complete.mutualRelations.length,37,'Rendering never truncates source data');
  assert.equal(complete.mutualRelations[0].key,'canonical-0','Rendering never reorders source data');
  if(process.env.REPORT_TEST_OUTPUT){
    const {writeFile}=await import('node:fs/promises');
    await writeFile(`${process.env.REPORT_TEST_OUTPUT}.html`,completeHtml);
    await writeFile(`${process.env.REPORT_TEST_OUTPUT}.pdf`,completePdf!);
  }
  const schema = buildSchema(typeDefs);
  for (const name of ['Pdf','Docx','Html']) assert.deepEqual(validate(schema, parse(`query($graph:ReportGraphInput){reportVerdict${name}(graph:$graph){filename base64}}`)), []);

  const cases = [{id: 1, caseId: 'A', caseName: 'A'}, {id: 2, caseId: 'B', caseName: 'B'}];
  const accounts = [10,20,30].map((id, i) => ({id, suspectId: 1, accountNumber: String(id), bankName: null, accountHolderName: null}));
  const transactions = [[1,10],[2,20],[3,30],[4,10]].map(([id,bankAccountId]) => ({id,bankAccountId,
    timestamp: '2026-11-01T10:00:00Z', amount: 100, type: 'credit', description: null,
    counterpartyAccount: '20', counterpartyName: null, counterpartyNationalId: null}));
  let active = 1, changeDuringRead = false, generated = 0;
  const received: VerdictInput[] = [];
  const generate = async (value: VerdictInput) => {received.push(value); generated++; return Buffer.from('report');};
  const ctx = {
    user: {id: 1, role: 'DETECTIVE'}, auth: {accessibleCaseIds: async () => new Set([1])},
    session: {getCurrentCase: async () => cases.find(c=>c.id === active)},
    suspects: {getAllSuspects: async () => [{id:1, caseId:'A', nationalId:null}]},
    evidence: {getForCase: async () => []}, conclusions: {getForCase: async () => []},
    data: {getAllCaseFiles: async () => cases, getAllBankAccounts: async () => accounts,
      getCaseBankAccounts: async () => [{caseFileId:1,bankAccountId:10,isStatement:true,removed:false},
        {caseFileId:1,bankAccountId:20,isStatement:false,removed:false}],
      getAllTransactions: async () => {if (changeDuringRead) active = 2; return transactions;}},
    noise: {getForCase: async () => ({minAmount:0,ignoredPairs:[],ignoredTxns:[4],descRules:[]})},
    reports: {generateVerdictPdf: generate, generateVerdictDocx: generate, generateVerdictHtml: generate},
    audit: {record: async () => undefined},
  } as unknown as GraphQLContext;
  const query = (g: typeof graphInput | null = graphInput, c = ctx) => resolvers.Query.reportVerdictPdf(null, {graph:g}, c);
  await assert.rejects(query(graphInput,{...ctx,user:null}), /Нэвтрэх/);
  await assert.rejects(query({...graphInput,caseFileId:2}), /өөр хэрэг/);
  await assert.rejects(query(graphInput,{...ctx,auth:{accessibleCaseIds:async()=>new Set([2])}} as any), /эрхгүй/);
  assert.equal(generated,0);
  await query();
  assert.equal(received[0].graph?.width,160);
  assert.deepEqual(received[0].analyses.map(a=>[a.accountId,a.txnCount]), [[10,1]],
    'Counterparty-only and unselected owner statements plus removed transactions stay out');
  await resolvers.Query.reportVerdictDocx(null,{graph:graphInput},ctx);
  await resolvers.Query.reportVerdictHtml(null,{graph:graphInput},ctx);
  assert(received.every(r=>r.graph?.imageBase64===graph.imageBase64));
  await query(null); assert.equal(received.at(-1)?.graph,undefined);
  const uploadId=await resolvers.Mutation.beginReportGraphUpload(null,{caseFileId:1},ctx);
  const text=graphInput.imageBase64;
  assert.equal(await resolvers.Mutation.appendReportGraphUpload(null,{uploadId,offset:0,chunk:text},ctx),text.length);
  await query({...graphInput,imageBase64:'',imageUploadId:uploadId} as any);
  assert.equal(received.at(-1)?.graph?.imageBase64,graph.imageBase64);
  assert.throws(()=>takeGraphUpload(uploadId,1,1),'Consumed upload is immediately reclaimed');
  const imageStage=beginGraphUpload(1,1),analysisStage=beginGraphUpload(1,1);
  appendGraphUpload(imageStage,1,0,graphInput.imageBase64);
  appendGraphUpload(analysisStage,1,0,encoded);
  await query({...graphInput,imageBase64:'',imageUploadId:imageStage,analysisBase64:'',analysisUploadId:analysisStage} as any);
  assert.equal(received.at(-1)?.graph?.analysis?.shared.rows.length,20);
  assert.throws(()=>takeGraphUpload(imageStage,1,1));assert.throws(()=>takeGraphUpload(analysisStage,1,1));
  const foreign=beginGraphUpload(1,2);appendGraphUpload(foreign,1,0,encoded);
  await assert.rejects(query({...graphInput,analysisUploadId:foreign} as any),/өөр хэрэг/);
  releaseGraphUpload(foreign,1);
  const beforeStale=generated;
  changeDuringRead=true;
  await assert.rejects(query(), /солигдсон/);
  assert.equal(generated,beforeStale,'Stale active case must not render a mixed report');
  console.log('PASS: no money PNG or direct-transfer table in PDF/Word/HTML; three retained A4 landscape graphs, relation lists below their images, shared top20 by money with full conclusions in PDF/Word/HTML, wrapped PDF notes, bounded image/JSON validation, chunk cleanup, authorization, exact case/noise scope and stale-case rejection');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
