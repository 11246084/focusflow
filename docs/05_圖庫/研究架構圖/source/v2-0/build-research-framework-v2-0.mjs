/** Chapter 3 illustration: deterministic SVG geometry, no generated bitmaps. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const sourceDir=path.dirname(fileURLToPath(import.meta.url));
const frameworkDir=path.resolve(sourceDir,'../..');
const resultsDir=path.join(frameworkDir,'results','v2-0');
const recordsDir=path.join(frameworkDir,'records','v2-0');
const artifactsDir=resultsDir;
const evidenceDir=recordsDir;
const notesDir=recordsDir;
const root=path.resolve(sourceDir,'../../../../..');
const stem='focusflow-research-framework-v2-0';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const preservation=path.join(evidenceDir,'v1-preservation.json');
const W=1100,H=1116;
const C={ink:'#17232c',muted:'#50616d',line:'#687b86',blue:'#2a6a98',light:'#edf5fa',teal:'#277d78',mint:'#e9f5f1',gold:'#aa711f',cream:'#fff5dc',white:'#ffffff'};
const a=[];
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function rect(x,y,w,h,fill='white',stroke=C.line,rx=3,dash=''){a.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash?` stroke-dasharray="${dash}"`:''}/>`);}
function text(x,y,s,size=22,color=C.ink,anchor='middle',bold=false,max=0){a.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${bold?600:400}"${max?` data-max-width="${max}"`:''}>${esc(s)}</text>`);}
function line(x,y,X,Y,color=C.line,width=1.8){a.push(`<line x1="${x}" y1="${y}" x2="${X}" y2="${Y}" stroke="${color}" stroke-width="${width}"/>`);}
function p(d,fill='none',stroke=C.ink,width=1.8,extra=''){a.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`);}
function circle(x,y,r,fill='white',stroke=C.ink){a.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);}
function arrow(x,y,X,Y,color=C.ink){p(`M${x} ${y} L${X} ${Y}`,'none',color,2.6,`marker-end="url(#${color===C.gold?'arr-gold':color===C.blue?'arr-blue':'arr'})"`);}
function title(n,x,y,s,w){text(x,y,`Step ${n}`,29,C.ink,'start',true,110);text(x+111,y,s,27,C.ink,'start',true,w-124);}
function sheet(x,y,w,h,accent=C.blue){rect(x+8,y-8,w,h,C.white,C.line);rect(x+4,y-4,w,h,C.white,C.line);rect(x,y,w,h,C.white,accent);}
function rules(x,y,w,n=3,color=C.line){for(let i=0;i<n;i++)line(x,y+i*12,x+w-(i%2)*18,y+i*12,color,2);}
function person(x,y,scale=1,color=C.blue){a.push(`<g transform="translate(${x} ${y}) scale(${scale})">`);circle(0,0,12,'#f5e5d4');p('M-12 -3 Q-13 -20 1 -17 Q16 -15 12 0 L5 -7 L-3 -3 Z',C.ink,C.ink);p('M-25 49 Q-27 19 -10 18 L10 18 Q27 20 25 49 Z',color,C.ink);p('M-9 19 L0 31 L9 19',C.white,C.line);line(-16,33,-22,51);line(16,33,23,48);a.push('</g>');}
function film(x,y,w,h,play=false){
  rect(x,y,w,h,C.white,C.ink);rect(x,y,w,10,C.ink,C.ink,0);rect(x,y+h-10,w,10,C.ink,C.ink,0);
  for(let i=8;i<w-8;i+=18){rect(x+i,y+3,8,4,C.white,'none',0);rect(x+i,y+h-7,8,4,C.white,'none',0);}
  rect(x+12,y+18,w-24,h-36,'#f0f5ee',C.line,0);
  const s=Math.min(.65,(h-34)/76);person(x+w*.25,y+20+12*s,s,C.teal);line(x+w*.50,y+29,x+w-20,y+29,C.line);line(x+w*.50,y+41,x+w-22,y+41,C.line);
  if(play){circle(x+w-22,y+h-25,12,C.white,C.blue);p(`M${x+w-26} ${y+h-31} L${x+w-16} ${y+h-25} L${x+w-26} ${y+h-19} Z`,C.blue,C.blue);}
}
function db(x,y,w,h){p(`M${x} ${y+16} V${y+h-16} C${x} ${y+h+5} ${x+w} ${y+h+5} ${x+w} ${y+h-16} V${y+16}`,C.light,C.blue);a.push(`<ellipse cx="${x+w/2}" cy="${y+16}" rx="${w/2}" ry="16" fill="${C.white}" stroke="${C.blue}" stroke-width="1.8"/>`);p(`M${x} ${y+h-36} C${x} ${y+h-15} ${x+w} ${y+h-15} ${x+w} ${y+h-36}`,'none',C.blue);}
function bubble(x,y,w,h,color=C.blue){p(`M${x+6} ${y} H${x+w-6} Q${x+w} ${y} ${x+w} ${y+6} V${y+h-6} Q${x+w} ${y+h} ${x+w-6} ${y+h} H${x+23} L${x+12} ${y+h+10} V${y+h} H${x+6} Q${x} ${y+h} ${x} ${y+h-6} V${y+6} Q${x} ${y} ${x+6} ${y} Z`,C.white,color);}
function miniVector(x,y,color=C.blue){for(let r=0;r<3;r++)for(let c=0;c<5;c++)rect(x+c*16,y+r*14,10,9,(r+c)%3===0?color:(color===C.gold?C.cream:C.light),'none',0);}

a.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="ff-v2-title ff-v2-desc">`);
a.push('<title id="ff-v2-title">FocusFlow 教學影片知識化與學習回饋流程</title><desc id="ff-v2-desc">教學影片產生逐字稿及文字片段並建立語意索引；學生在課程範圍內提問，取得附影片來源的回答；累積提問另形成腳本，經教師在系統外製作與審核後提供複習短影音。</desc>');
a.push('<defs><style>text{font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif}</style>');
for(const [id,c]of [['arr',C.ink],['arr-blue',C.blue],['arr-gold',C.gold]])a.push(`<marker id="${id}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="${c}"/></marker>`);
a.push('</defs>');rect(0,0,W,H,C.white,'none',0);

// Four semantic panels. No page title, audit labels, or English duplicate headings.
rect(60,8,676,320,C.white,C.line,10,'7 5');rect(764,8,328,320,C.white,C.line,10,'7 5');
rect(60,366,1032,400,C.white,C.line,10,'7 5');rect(60,812,1032,296,C.white,C.line,10,'7 5');
title(1,80,46,'教學影片知識化',636);title(2,784,46,'語意索引',300);
title(3,80,404,'課程問答與影片回溯',900);title(4,80,850,'提問回饋與短影音教材',960);

// Connector paths outside panel interiors are painted before artifacts.
arrow(722,155,782,155,C.blue);
arrow(928,328,928,366,C.blue);
// Questions are accumulated independently of successful answer playback.
p('M88 461 H30 Q22 461 22 469 V927 Q22 935 30 935 H78','none',C.gold,2.6,'marker-end="url(#arr-gold)"');

// STEP 1: concrete intermediate artifacts.
film(82,113,130,95);text(147,247,'教學影片',23);
arrow(220,158,247,158);
for(let i=0;i<13;i++){const h=[8,18,30,42,22,58,38,52,30,18,36,16,8][i];line(256+i*5,159-h/2,256+i*5,159+h/2,C.blue,3);}
text(287,247,'語音辨識',22);
arrow(327,158,353,158);
sheet(368,109,133,106);text(434,140,'00:20',22,C.blue);rules(382,158,104,3);text(434,247,'時間逐字稿',23);
arrow(512,158,538,158);
// Short manuscript strips aligned against a shared timeline.
for(let i=0;i<3;i++){rect(551,104+i*39,155,31,i===1?C.mint:C.light,i===1?C.teal:C.blue);text(563,127+i*39,`c${['₁','₂','₃'][i]}`,23,C.ink,'start');rules(597,115+i*39,96,1,i===1?C.teal:C.blue);}
text(628,247,'文字片段',23);
text(398,295,'時間對齊 · 文字正規化 · 規則式分段',22,C.muted);

// STEP 2: vectors are demonstrative geometric symbols, not measured values.
miniVector(802,102);miniVector(906,102,C.teal);text(928,180,'Gemini Embedding',22,C.ink);
arrow(928,194,928,216,C.blue);db(864,228,128,46);
text(928,310,'影片知識庫',23);

// STEP 3: query/evidence/LLM/playback, with question and content lanes.
bubble(88,435,253,66,C.gold);text(214,477,'這個概念如何應用？',22);
person(130,546,.95,C.gold);text(130,638,'學生提問',23);
miniVector(221,551,C.gold);text(259,624,'問題向量',22);
arrow(173,574,207,574,C.gold);
// Transformation of question into query vector (within the same input group).
p('M305 508 V524 Q305 532 297 532 H267 Q259 532 259 540','none',C.gold,2.2,'marker-end="url(#arr-gold)"');
arrow(303,575,343,575,C.gold);
rect(359,477,205,172,C.white,C.line,8,'5 4');
text(461,510,'授權課程範圍',22,C.ink);
// Magnifier inspecting a miniature collection of snippets.
for(let i=0;i<3;i++){rect(386+i*17,538+i*7,71,53,i===2?C.light:C.white,C.line,2);}
circle(487,564,24,'none',C.blue);line(504,581,521,598,C.blue,5);text(461,630,'語意檢索',24,C.blue);
// Knowledge-store feed enters the retrieval region in the empty upper lane.
p('M928 367 V428 Q928 436 920 436 H594 Q586 436 586 444 V452 Q586 460 578 460 H469 Q461 460 461 468 V477','none',C.blue,2.2,'marker-end="url(#arr-blue)"');
arrow(576,575,607,575,C.blue);
sheet(620,499,155,150,C.teal);
text(697,531,'課程證據',23,C.teal);
for(let i=0;i<3;i++){text(634,570+i*34,`S${i+1}`,22,C.ink,'start');line(670,562+i*34,756,562+i*34,i===1?C.line:C.teal,3);}
arrow(789,575,818,575,C.blue);
// Existing language model, no implied training stage.
rect(833,504,209,112,C.light,C.blue,10);
for(const [x,y]of [[860,530],[860,557],[887,543],[912,530],[912,557]])circle(x,y,4,C.white,C.blue);
line(864,530,883,543,C.blue);line(864,557,883,543,C.blue);line(891,543,908,530,C.blue);line(891,543,908,557,C.blue);
text(977,548,'LLM',24,C.blue);text(938,592,'依據教材生成回答',22);
// Compact two-part answer/source artifact followed by original video location.
rect(693,671,197,76,C.white,C.teal,4);text(791,700,'回答＋來源片段',22);text(791,732,'S1、S3 · 00:20',22,C.teal);
p('M938 619 V650 Q938 658 930 658 H799 Q791 658 791 666 V671','none',C.blue,2.2,'marker-end="url(#arr-blue)"');
arrow(900,708,927,708,C.teal);
film(938,672,128,72,true);text(1016,648,'影片回溯',22);
text(462,705,'未取得相關依據',22,C.muted);text(462,739,'回覆資料不足',22,C.muted);
// No-answer outcome deliberately has its own short branch.
arrow(461,651,461,674,C.line);

// STEP 4: pictorial learning-material feedback; six artifacts, two role boundaries.
// Question bubbles visibly group, rather than an identical generic process box.
bubble(87,894,85,36,C.gold);bubble(109,941,85,36,C.gold);bubble(158,909,65,36,C.gold);
text(129,921,'Q₁',22,C.gold);text(150,968,'Q₂',22,C.gold);text(190,936,'Q₃',22,C.gold);
text(155,1038,'提問彙整',23);text(155,1070,'分群選題',22,C.muted);
arrow(227,946,252,946,C.gold);
sheet(268,900,106,97,C.teal);text(321,932,'課程證據',22,C.teal);rules(281,956,79,3);
text(321,1038,'證據包',23);text(321,1070,'固定快照',22,C.muted);
arrow(385,946,412,946,C.gold);
// Eight storyboard cells echo the documented eight-beat script format.
sheet(428,898,119,101,C.blue);
for(let i=0;i<8;i++){rect(437+(i%4)*26,911+Math.floor(i/4)*39,21,29,i%2?C.mint:C.light,C.line,1);line(441+(i%4)*26,925+Math.floor(i/4)*39,454+(i%4)*26,925+Math.floor(i/4)*39,C.line);}
text(488,1038,'腳本生成',23);text(488,1070,'口白與分鏡',22,C.muted);
arrow(559,946,586,946,C.gold);
rect(599,884,184,203,C.white,C.gold,9,'5 4');text(691,916,'系統外製作',23,C.gold);
person(635,945,.73,C.teal);film(668,939,95,64,false);
text(691,1038,'教師製作',23);text(691,1070,'外部工具',22,C.muted);
arrow(795,946,820,946,C.gold);
// Review signoff.
sheet(837,900,93,94,C.blue);circle(884,944,25,C.mint,C.teal);p('M870 945 L880 954 L899 932','none',C.teal,4);
text(884,1038,'成品審核',23);text(884,1070,'通過上架',22,C.muted);
arrow(943,946,968,946,C.gold);
rect(983,889,81,118,C.white,C.ink,9);rect(990,907,67,76,C.light,C.line,1);p('M1013 927 L1037 943 L1013 959 Z',C.blue,C.blue);circle(1024,995,3,C.white,C.line);
text(1024,1038,'短影音',23);text(1024,1070,'學生複習',22,C.muted);
a.push('</svg>');
const svg=a.join('\n');
fs.writeFileSync(path.join(artifactsDir,`${stem}.svg`),'<?xml version="1.0" encoding="UTF-8"?>\n'+svg+'\n');
fs.writeFileSync(path.join(artifactsDir,`${stem}.html`),`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>FocusFlow 第三章說明圖 第二版</title><style>html,body{margin:0;background:white}svg{display:block;width:1100px;height:1116px}@page{size:160mm 162.327mm;margin:0}@media print{svg{width:160mm;height:auto}}</style></head><body>${svg}</body></html>\n`);
const intro='本系統的核心處理流程如圖3-1-2所示。教學影片先經語音辨識、文字正規化與規則式分段，建立帶時間資訊的語意索引。學生於授權課程內提問後，系統檢索教材片段並生成回答，提供來源與影片時間跳轉；累積提問另可轉為短影音腳本，由教師於系統外製作成品，經審核後供學生複習。';
const caption='圖3-1-2　FocusFlow 教學影片知識化與學習回饋流程';
const source='資料來源：本研究依系統程式碼與規格整理繪製。圖中素材、文字與時間為示意。';
fs.writeFileSync(path.join(artifactsDir,'chapter03-placement-v2-0.html'),`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>第三章圖文排版預覽</title><style>*{box-sizing:border-box}html,body{margin:0;background:#ddd}.page{width:210mm;min-height:297mm;padding:20mm 25mm;background:white;color:#111;font:12pt/1.7 "DFKai-SB","Microsoft JhengHei",serif;margin:auto}h1{font-size:16pt;margin:0 0 5mm}p{text-align:justify;margin:0 0 5mm}.figure{margin:0}svg{display:block;width:160mm;height:auto}figcaption{font-size:11pt;text-align:center;margin-top:3mm}.source{font-size:10pt;line-height:1.5;margin-top:2mm}.note{font-size:10pt;color:#555;margin-top:8mm}@page{size:A4;margin:0}@media print{html,body{background:white}}</style></head><body><article class="page"><h1>3-1　系統架構</h1><p>${intro}</p><figure class="figure">${svg}<figcaption>${caption}</figcaption></figure><p class="source">${source}</p><p class="note">第三章插圖排版預覽；圖號及插入位置待正文編排確認。</p></article></body></html>\n`);
fs.writeFileSync(path.join(notesDir,'chapter03-insertion-v2-0.md'),`# 第三章圖文插入建議（尚未修改正文）\n\n建議置於 3-1「系統架構」末段、3-2 之前，作為圖3-1-2；保留既有圖3-1-1的技術架構視角。以下圖號為建議，待手冊編排確認。\n\n${intro}\n\n![${caption}](../../results/v2-0/focusflow-research-framework-v2-0.png)\n\n${caption}\n\n${source}\n\n建議圖片寬度 16 cm，不加圖片內大標題；圖說及來源文字放在 Word 正文。從第三章 Markdown 引用本次圖稿時，路徑為 \`../../Research_Framework/results/v2-0/focusflow-research-framework-v2-0.png\`。\n`);
const old=JSON.parse(fs.readFileSync(path.join(frameworkDir,'records','v1-0','focusflow-research-framework-v1-0.manifest.json'),'utf8'));
const sourceFiles=Object.fromEntries(Object.keys(old.sourceFiles).map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]));
const referenceFiles=['1668497.jpg','1668506.jpg'].map(name=>{const p=path.join('C:/Users/User/Download',name);return {name,role:'User supplied layout reference only; author/publication unknown',sha256:fs.existsSync(p)?hash(fs.readFileSync(p)):null};});
const manifest={version:'v2.0',date:'2026-09-27',purpose:'System Manual Chapter 3 inline explanatory figure',status:'draft for human review',repositoryCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceFiles,referenceFiles,stepMapping:{step1:['R01','R02'],step2:['R03'],step3:['R04','R05','R06'],step4:['R07']},generator:'Node.js standard library; explicitly authored SVG primitives',usesGeneratedRaster:false,font:'Microsoft JhengHei; Noto Sans TC fallback',viewBox:{width:W,height:H},intendedWidthMm:160,minimumLabelFontPx:22,minimumLabelFontPtAt160mm:Number((22*160*72/(25.4*W)).toFixed(2)),artifacts:{}};
for(const [name,file] of [[`results/v2-0/${stem}.svg`,path.join(artifactsDir,`${stem}.svg`)],[`results/v2-0/${stem}.html`,path.join(artifactsDir,`${stem}.html`)],['results/v2-0/chapter03-placement-v2-0.html',path.join(artifactsDir,'chapter03-placement-v2-0.html')],['records/v2-0/chapter03-insertion-v2-0.md',path.join(notesDir,'chapter03-insertion-v2-0.md')],[`source/v2-0/${path.basename(fileURLToPath(import.meta.url))}`,fileURLToPath(import.meta.url)]])manifest.artifacts[name]=hash(fs.readFileSync(file));
fs.writeFileSync(path.join(evidenceDir,`${stem}.manifest.json`),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({version:'v2.0',svgHash:manifest.artifacts[`results/v2-0/${stem}.svg`],minimumFontPt:manifest.minimumLabelFontPtAt160mm},null,2));
