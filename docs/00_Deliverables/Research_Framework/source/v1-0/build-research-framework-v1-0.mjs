/** Deterministic, dependency-free SVG authoring. No image generation or network. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const frameworkDir = path.resolve(sourceDir, '../..');
const resultsDir = path.join(frameworkDir, 'results', 'v1-0');
const recordsDir = path.join(frameworkDir, 'records', 'v1-0');
const artifactsDir = resultsDir;
const evidenceDir = recordsDir;
const root = path.resolve(sourceDir, '../../../../..');
const stem = 'focusflow-research-framework-v1-0';
const W = 1280, H = 1776;
// Local design tokens: user-supplied white-paper / dashed-Step reference.
const C = { paper:'#ffffff', ink:'#192b3a', muted:'#526575', rule:'#8c9ba6', pale:'#eef4f8', blue:'#23618a', teal:'#247b76', tint:'#eef8f6', amber:'#9b621b', warm:'#fff7e9' };
const out = [];
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function rect(x,y,w,h,fill=C.paper,stroke=C.rule,rx=4,dash='') { out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`); }
function text(x,y,s,size=18,fill=C.ink,weight=400,anchor='start',max=0) { out.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}"${max ? ` data-max-width="${max}"` : ''}>${esc(s)}</text>`); }
function line(x1,y1,x2,y2,color=C.rule,width=1.5) { out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`); }
function arrow(x1,y1,x2,y2,color=C.muted) { out.push(`<path d="M${x1} ${y1} L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2.2" marker-end="url(#${color===C.amber?'arrow-accent':'arrow'})"/>`); }
function pathShape(d,fill='none',stroke=C.ink,width=2,extra='') { out.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`); }
function circle(x,y,r,fill=C.paper,stroke=C.ink) { out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`); }
function panel(n,x,y,w,h,title,en,ref,warm=false) {
  const color=warm?C.amber:C.blue;
  out.push(`<g id="step-${n}" data-panel="${x},${y},${w},${h}">`);
  rect(x,y,w,h,C.paper,C.rule,0,'6 4');
  rect(x+2,y+2,w-4,48,warm?C.warm:C.pale,'none',0);
  text(x+18,y+33,`Step ${n}`,25,color,700);
  text(x+116,y+33,title,24,C.ink,700,'start',w-210);
  text(x+w-16,y+32,ref,14,C.muted,400,'end');
  text(x+18,y+72,en,14,C.muted);
}
function end(){out.push('</g>');}
function card(x,y,w,h,title,sub='',color=C.blue) {
  rect(x,y,w,h,C.paper,color);
  rect(x+1,y+1,w-2,29,color===C.teal?C.tint:C.pale,'none');
  text(x+10,y+21,title,16,color,600,'start',w-20);
  if(sub)text(x+10,y+51,sub,15,C.muted,400,'start',w-20);
  if(h>=80)for(let i=0;i<2;i++)line(x+12,y+h-22+i*9,x+w-18-i*16,y+h-22+i*9,C.rule,2);
}
function video(x,y,w,h,label='教學影片') {
  rect(x,y,w,h,C.pale,C.ink);
  rect(x+10,y+10,w-20,h-39,C.paper,C.rule);
  pathShape(`M${x+w/2-9} ${y+22} L${x+w/2+13} ${y+36} L${x+w/2-9} ${y+50} Z`,C.blue,C.blue,1);
  line(x+12,y+h-16,x+w-12,y+h-16,C.rule,3);
  circle(x+36,y+h-16,4,C.blue,C.blue);
  text(x+w/2,y+h+23,label,16,C.ink,400,'middle');
}
function box(x,y,w,h,lines,color=C.blue){rect(x,y,w,h,color===C.teal?C.tint:C.pale,color);lines.forEach((s,i)=>text(x+w/2,y+29+i*24,s,17,C.ink,500,'middle',w-16));}

out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${stem}-title ${stem}-desc">`);
out.push(`<title id="${stem}-title">FocusFlow 整體研究架構</title><desc id="${stem}-desc">教學影片經轉錄、分段與向量索引，支援課程內問答及來源跳轉；提問紀錄另供腳本選題，影片由教師在系統外製作與審核。</desc>`);
out.push(`<defs><style>text{font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif}</style>`);
for(const [id,color] of [['arrow',C.muted],['arrow-accent',C.amber],['arrow-soft',C.rule]])out.push(`<marker id="${id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${color}"/></marker>`);
out.push('</defs>');rect(0,0,W,H,C.paper,'none',0);
text(72,47,'FocusFlow 整體研究架構',35,C.ink,700);
text(72,80,'教學影片知識化、證據問答與短影音回饋',20,C.muted);
text(1208,47,'可追溯圖稿 · v1.0',16,C.muted,400,'end');
text(1208,78,'2026-09-27｜待人工審閱',14,C.muted,400,'end');

// Main handoffs are separate from internal artifact transformations.
arrow(624,248,656,248);arrow(928,368,928,408);arrow(640,648,640,688);
arrow(332,976,332,1016);arrow(608,1160,656,1160);
// A recorded-question branch, not a mandatory next step after playback.
pathShape('M104 808 H40 Q32 808 32 816 V1444 Q32 1452 40 1452 H72','none',C.amber,2.2,'marker-end="url(#arrow-accent)"');

panel(1,72,112,552,256,'影片轉錄與正規化','Video transcription and normalization','[R01]');
video(92,210,112,78);arrow(215,249,238,249);
for(let i=0;i<13;i++){const h=[10,22,32,18,42,28,50,32,24,38,20,12,8][i];line(248+i*4,249-h/2,248+i*4,249+h/2,C.blue,2.5);}
text(272,310,'音訊',16,C.ink,400,'middle');arrow(307,249,331,249);
card(344,206,138,87,'時間逐字稿','00:20–00:28');
arrow(490,249,512,249);box(524,212,80,75,['術語','字典']);
text(348,337,'FFmpeg → Faster-Whisper → 術語正規化',15,C.muted,400,'middle');end();

panel(2,656,112,552,256,'時間片段建構','Timestamped transcript chunking','[R02]');
line(682,214,1180,214,C.muted,2);
const times=['00:20–00:28','00:28–00:36','00:36–00:44'];
times.forEach((t,i)=>{const x=684+i*169;arrow(x+71,216,x+71,239);card(x,249,150,70,`Chunk ${i+1}`,t,i===1?C.teal:C.blue);});
text(932,344,'依文字長度、段數與時間跨度整併',16,C.muted,400,'middle');end();

panel(3,72,408,1136,240,'影片語意知識庫','Semantic video knowledge base construction','[R03]');
times.forEach((t,i)=>{rect(94,499+i*32,170,28,i===1?C.tint:C.pale,C.rule);text(104,519+i*32,`C${i+1}  ${t}`,15);});
arrow(278,546,310,546);box(324,506,172,80,['Gemini Embedding','片段語意向量']);arrow(508,546,540,546);
text(636,508,'向量表示（示意）',16,C.muted,400,'middle');
for(let r=0;r<3;r++)for(let c=0;c<8;c++)rect(559+c*19,525+r*18,13,12,(r+c)%3===0?C.blue:C.pale,'none',0);
arrow(728,546,760,546);
pathShape('M778 515 V578 C778 600 944 600 944 578 V515',C.pale,C.blue,1.5);
out.push(`<ellipse cx="861" cy="515" rx="83" ry="17" fill="${C.pale}" stroke="${C.blue}" stroke-width="1.5"/>`);
text(861,554,'影片知識庫',20,C.ink,600,'middle');text(861,577,'MongoDB Atlas',14,C.muted,400,'middle');
rect(975,498,209,100,C.paper,C.rule);
['影片來源 · 片段識別','文字內容 · 起訖時間','語意向量'].forEach((s,i)=>text(989,521+i*29,s,16));
text(640,628,'片段與問題使用相容的向量契約；時間資訊一路保留至引用',16,C.muted,400,'middle');end();

panel(4,72,688,1136,288,'對話脈絡與課程證據檢索','Context-aware, course-scoped evidence retrieval','[R04]');
rect(104,784,230,108,C.paper,C.blue);
text(118,809,'學生問題＋近期對話',18,C.blue,600);
text(118,839,'什麼是向量搜尋？',17);text(118,868,'那它有什麼限制？',17);
arrow(346,833,374,833);box(388,795,142,77,['補足追問主題','問題向量']);
arrow(542,833,570,833);box(584,795,178,77,['課程範圍內','語意檢索']);
text(673,782,'授權範圍過濾',16,C.teal,600,'middle');
arrow(774,833,802,833);
[['S1','影片 A','00:20–00:28'],['S3','影片 A','00:28–00:36'],['S2','影片 B','01:10–01:28']].forEach((a,i)=>{rect(816,784+i*37,368,31,i===2?C.paper:C.tint,C.rule);text(830,806+i*37,`${a[0]}   ${a[1]}   ${a[2]}`,16);});
text(1000,919,'依影片與時間組織證據',16,C.muted,400,'middle');
rect(104,918,655,35,C.paper,C.rule,0,'4 4');
text(116,942,'條件式擴充：相鄰片段補全／Parent–Child 檢索（開關控制）',15,C.muted);
end();

panel(5,72,1016,536,292,'依據教材生成回答','Evidence-grounded answer generation','[R05]');
card(94,1108,122,88,'問題＋證據','S1 · S2 · S3');arrow(226,1151,248,1151);
box(260,1117,104,70,['既有 LLM','回答生成']);arrow(374,1151,396,1151);
card(408,1108,176,88,'回答＋證據 ID','採用 S1、S3',C.teal);
text(408,1222,'檢查格式與編號',16,C.muted);
text(96,1253,'無相關依據時回覆資料不足',17,C.muted);
text(96,1281,'編號有效不等於語意正確性已獲證明',14,C.muted);
end();

panel(6,656,1016,552,292,'來源引用與影片跳轉','Source citation and timestamp navigation','[R06]');
rect(680,1108,229,139,C.paper,C.rule);text(694,1134,'回答內容（介面示意）',17,C.ink,600);
line(695,1152,887,1152,C.rule,2);line(695,1163,858,1163,C.rule,2);
rect(694,1177,201,26,C.tint,C.teal);text(704,1196,'影片 A  00:20  [S1]',15);
rect(694,1211,201,26,C.tint,C.teal);text(704,1230,'影片 A  00:28  [S3]',15);
arrow(920,1190,947,1190);video(960,1144,224,102,'點擊時間戳，回到原影片');
end();

panel(7,72,1360,1136,288,'提問回饋與複習短影音','Question-driven review video development','[R07]',true);
text(1208-18,1437,'回饋支線',16,C.amber,600,'end');
const x7=[96,278,460,658,870,1052];
box(x7[0],1472,146,86,['提問紀錄','分群與選題']);
box(x7[1],1472,146,86,['課程證據','檢索與保存']);
box(x7[2],1472,162,86,['短影音腳本','結構化生成']);
rect(x7[3],1460,176,112,C.warm,C.amber,0,'5 4');text(746,1487,'系統外／人工',15,C.amber,600,'middle');text(746,1516,'教師製作影片',18,C.ink,600,'middle');text(746,1544,'外部影片工具',15,C.muted,400,'middle');
box(x7[4],1472,146,86,['上傳成品','教師審核']);
rect(x7[5],1472,130,86,C.pale,C.blue);text(1117,1501,'審核通過',17,C.ink,500,'middle');text(1117,1528,'學生複習',17,C.ink,500,'middle');
[[242,278],[424,460],[622,658],[834,870],[1016,1052]].forEach(([a,b])=>arrow(a+4,1515,b-8,1515,C.amber));
text(640,1617,'從累積提問形成複習教材；影片產製由教師於系統外完成',17,C.muted,400,'middle');end();

line(72,1680,1208,1680,C.rule,1);
text(72,1710,'資料來源：本研究系統程式碼與規格整理繪製；[R01]–[R07] 對照來源紀錄。',16,C.ink);
text(72,1740,'片段、時間、向量及介面均為示意；未宣稱正式環境啟用狀態或實驗成效。',15,C.muted);
out.push('</svg>');
const svg=out.join('\n');
fs.writeFileSync(path.join(artifactsDir,`${stem}.svg`),'<?xml version="1.0" encoding="UTF-8"?>\n'+svg+'\n');
fs.writeFileSync(path.join(artifactsDir,`${stem}.html`),`<!doctype html>\n<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FocusFlow 研究架構 v1.0</title><style>html,body{margin:0;background:white}svg{display:block;max-width:100%;height:auto}@page{size:320mm 444mm;margin:0}@media print{svg{width:320mm;height:444mm;max-width:none}}</style></head><body>${svg}</body></html>\n`);

const sources={
 R01:['STT_Whisper/src/main.py','STT_Whisper/src/transcribe.py','STT_Whisper/src/normalize_transcript.py'],
 R02:['STT_Whisper/src/chunking.py','STT_Whisper/src/chunk_strategy.py'],
 R03:['STT_Whisper/src/embedding.py','STT_Whisper/src/embedding_contract.py','STT_Whisper/src/mongodb_uploader.py','backend/src/services/queryEmbedding.service.js'],
 R04:['backend/src/services/contextualQuestion.service.js','backend/src/services/qa.service.js','backend/src/services/answerGeneration.service.js','backend/src/services/leafContextSelection.service.js','backend/src/config/env.js'],
 R05:['backend/src/services/answerGeneration.service.js'],
 R06:['backend/src/services/qa.service.js','frontend/focus-flow/src/pages/StudentCourses.jsx'],
 R07:['backend/src/services/shortScriptTopic.service.js','backend/src/services/shortScript.service.js','backend/src/services/shortAssetPublish.service.js','docs/00_Deliverables/System_Manual/chapters/03_系統規格.md'],
};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceFiles=Object.fromEntries([...new Set(Object.values(sources).flat())].map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]));
const manifest={version:'v1.0',authoredOn:'2026-09-27',repositoryCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),generator:'Node.js standard library / explicit SVG primitives',nodeVersion:process.version,usesGeneratedRaster:false,externalAssets:[],font:'Microsoft JhengHei (local, not embedded); Noto Sans TC / sans-serif fallback',sources,sourceFiles,artifacts:{[`results/v1-0/${stem}.svg`]:hash(fs.readFileSync(path.join(artifactsDir,`${stem}.svg`))),[`results/v1-0/${stem}.html`]:hash(fs.readFileSync(path.join(artifactsDir,`${stem}.html`))),[`source/v1-0/${path.basename(fileURLToPath(import.meta.url))}`]:hash(fs.readFileSync(fileURLToPath(import.meta.url)))}};
fs.writeFileSync(path.join(evidenceDir,`${stem}.manifest.json`),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({outputs:[`results/v1-0/${stem}.svg`,`results/v1-0/${stem}.html`,`records/v1-0/${stem}.manifest.json`],sourceCount:Object.keys(sourceFiles).length,svgHash:manifest.artifacts[`results/v1-0/${stem}.svg`]},null,2));
