/**
 * Deterministic, self-authored SVG.
 * Figures A and B (01, 02) are independent figures built from one real web follow-up record
 * (questions 6ab8d5ddd2df5d6e221eb8b7, 2026-09-27); only the embedding colour strip is illustrative.
 * Step 4 of figure B embeds two real screenshots from source/v3-0/assets (captured 2026-09-27). Figure C (03) uses real shortscripts/shortassets records and a student-side screenshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const base=path.resolve(here,'../..'),root=path.resolve(base,'../../..');
const output=path.join(base,'results/v3-0'),records=path.join(base,'records/v3-0');
fs.mkdirSync(output,{recursive:true});fs.mkdirSync(records,{recursive:true});
const C={ink:'#203442',muted:'#596b76',line:'#a4b3bc',q:'#a96517',qp:'#fff5e6',d:'#286a9a',dp:'#edf5fb',a:'#267b6e',ap:'#eef8f4'};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let s=[];
function box(x,y,w,h,fill='white',stroke=C.line,dash=false){s.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash?' stroke-dasharray="7 5"':''}/>`);}
function t(x,y,value,size=23,color=C.ink,bold=false,max=1000){s.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${bold?600:400}" data-max-width="${max}">${esc(value)}</text>`);}
function lines(x,y,values,size=23,color=C.ink,gap=33,max=1000){values.forEach((v,i)=>t(x,y+i*gap,v,size,color,false,max));}
function arrow(d,color=C.ink,dash=false){s.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2"${dash?' stroke-dasharray="7 5"':''} marker-end="url(#a${color.slice(1)})"/>`);}
function person(x,y,color){s.push(`<circle cx="${x}" cy="${y}" r="16" fill="white" stroke="${color}" stroke-width="2"/><path d="M${x-30} ${y+67} Q${x-30} ${y+24} ${x} ${y+24} Q${x+30} ${y+24} ${x+30} ${y+67} Z" fill="${color}" opacity=".8"/>`);}
function film(x,y,w,h,label){box(x,y,w,h,C.dp,C.d);box(x+10,y+10,w-20,h-40,'white',C.d);s.push(`<path d="M${x+26} ${y+27} l28 17 -28 17 Z" fill="${C.d}"/>`);t(x+14,y+h-12,label,21,C.d,false,w-24);}
function vector(x,y,color){for(let i=0;i<9;i++)box(x+i*16,y,10,24+(i%3)*8,color,color);}
function db(x,y,w,h){s.push(`<path d="M${x} ${y+17} V${y+h-17} C${x} ${y+h+7} ${x+w} ${y+h+7} ${x+w} ${y+h-17} V${y+17}" fill="${C.dp}" stroke="${C.d}" stroke-width="2"/><ellipse cx="${x+w/2}" cy="${y+17}" rx="${w/2}" ry="17" fill="white" stroke="${C.d}" stroke-width="2"/>`);}
function start(title,h){s=[`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${h}" viewBox="0 0 1100 ${h}" role="img" aria-labelledby="title"><title id="title">${esc(title)}</title><defs><style>text{font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif}</style>`];for(const color of [C.ink,C.q,C.d,C.a,C.muted])s.push(`<marker id="a${color.slice(1)}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8Z" fill="${color}"/></marker>`);s.push('</defs>');box(0,0,1100,h,'white','white');}
function panel(n,y,h,title){box(20,y,1060,h,'white',C.line,true);t(40,y+36,`Step ${n}`,26,C.ink,true);t(152,y+36,title,26,C.ink,true,880);}
function legend(y){t(36,y,'橙色：學生問題',21,C.q);t(275,y,'藍色：教材與來源',21,C.d);t(555,y,'綠色：回答與學習回饋',21,C.a);}
function save(name,title,h){s.push('</svg>');const svg=s.join('\n');fs.writeFileSync(path.join(output,name+'.svg'),svg+'\n');fs.writeFileSync(path.join(output,name+'.html'),`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>${title}</title><style>body{margin:0;background:white}svg{display:block;width:1100px;height:${h}px}@page{size:160mm ${h*160/1100}mm;margin:0}@media print{svg{width:160mm;height:auto}}</style>${svg}</html>\n`);return {name,title,width:1100,height:h};}

// Figures A/B share one real follow-up question, stable evidence IDs, and the same video timeline.
// Data: questions 6ab8d5ddd2df5d6e221eb8b7 + messages in conversation 6ab8d58ed2df5d6e221eb8a0
// (course「影片處理工具 - OpenCV」, 15 videos / 129 segments at 2026-09-27; 第十講 = videos 6a02f38c17c615e872035b94, 120 s).
function rich(x,y,parts,size=20,max=1000){s.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${C.ink}" data-max-width="${max}">${parts.map(([v,color=C.ink,bold=false])=>`<tspan fill="${color}" font-weight="${bold?700:400}">${esc(v)}</tspan>`).join('')}</text>`);}
function bubble(x,y,w,h,fill,stroke,tail){box(x,y,w,h,fill,stroke);s.push(tail==='right'?`<path d="M${x+w-18} ${y+h-1} l14 12 -2 -12Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`:`<path d="M${x+18} ${y+h-1} l-14 12 2 -12Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);}
function strip(x,y,n,cell,h){// illustrative only: deterministic shades, not the real 3072-d values
  let v=7;for(let i=0;i<n;i++){v=(v*37+11)%97;const o=(.18+(v/97)*.82).toFixed(2);s.push(`<rect x="${x+i*cell}" y="${y}" width="${cell-2}" height="${h}" fill="${C.q}" opacity="${o}"/>`);}}
function chip(x,y,w,label,fill,stroke,color,size=18){box(x,y,w,30,fill,stroke);t(x+w/2-label.length*size*.3,y+21,label,size,color,true,w);}
const mmss=sec=>`${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
// 第十講 chunk boundaries (video_segments_text, sorted by startSec) and retrieval rank of the candidates.
const L10=[[0,12.62],[12.62,32.12],[32.12,44.7],[44.7,56.98],[56.98,68.6],[68.6,86.8],[86.8,98.64],[98.64,117.58],[117.58,120.22]];
const L10rank={0:'S5',1:'S3',2:'S2',5:'S1',7:'S9'};
const adopted=new Set(['S1','S2','S3']);
function timeline(x,y,w,mode){
  const sx=sec=>x+sec/120.22*w;
  L10.forEach(([a,b],i)=>{const id=L10rank[i];const hit=mode==='adopted'?adopted.has(id):Boolean(id);
    const fill=hit?(mode==='adopted'?C.a:C.d):'white',stroke=id?(mode==='adopted'&&!hit?C.d:fill==='white'?C.line:fill):C.line;
    s.push(`<rect x="${sx(a)+1}" y="${y}" width="${sx(b)-sx(a)-2}" height="30" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${id&&!hit?' stroke-dasharray="4 3"':''}/>`);
    if(id)t((sx(a)+sx(b))/2-(id.length*6),y-9,id,19,hit?(mode==='adopted'?C.a:C.d):C.muted,hit);});
  for(const sec of [0,30,60,90,120]){t(sx(sec)-(sec?17:0),y+54,mmss(sec),16,C.muted);}
}
function legend2(y,items){let x=36;for(const [label,color] of items){t(x,y,label,21,color);x+=label.length*21+60;}}

// ---- Figures A/B visual vocabulary (after the two reference figures) ----
// hatched model glyphs, italic symbols, stacked cards for sets, a framing question on top.
const SERIF="'Times New Roman',Cambria,serif";
function hatchDefs(){for(const [id,color] of [['hq',C.q],['hd',C.d],['ha',C.a],['hk',C.ink]])s.push(`<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="white"/><line x1="0" y1="0" x2="0" y2="7" stroke="${color}" stroke-width="2.6"/></pattern>`);}
function symParts(str){return str.split(/(_\{[^}]+\}|_.)/).filter(Boolean).map(p=>p.startsWith('_')?`<tspan baseline-shift="sub" font-size="70%">${esc(p.replace(/^_\{?|\}$/g,''))}</tspan>`:esc(p)).join('');}
function sym(x,y,str,size=24,color=C.ink,anchor='start'){s.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-style="italic" style="font-family:${SERIF}" text-anchor="${anchor}" data-max-width="400">${symParts(str)}</text>`);}
function model(x,y,label,id,color){// three hatched blocks, like the M glyph of reference figure 1
  [[0,0,24,84],[30,12,24,60],[60,24,24,36]].forEach(([dx,dy,w,h])=>s.push(`<rect x="${x+dx}" y="${y+dy}" width="${w}" height="${h}" fill="url(#${id})" stroke="${color}" stroke-width="2"/>`));
  sym(x+42,y-10,label,26,color,'middle');}
function stack(x,y,w,h,n,fill,stroke){for(let i=n-1;i>0;i--)s.push(`<rect x="${x+i*7}" y="${y-i*7}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);box(x,y,w,h,fill,stroke);}
function card(x,y,w,h,title,body,color,fill){box(x,y,w,h,fill,color);if(title)t(x+12,y+24,title,15,color,true,w-20);lines(x+12,y+(title?48:26),body,15,C.ink,21,w-20);}
function vec(x,y,n,cell,h,color,seed=7){let v=seed;for(let i=0;i<n;i++){v=(v*37+11)%97;s.push(`<rect x="${x+i*cell}" y="${y}" width="${cell-2}" height="${h}" fill="${color}" opacity="${(.18+(v/97)*.82).toFixed(2)}"/>`);}}
function bigArrow(x,y1,y2){s.push(`<path d="M${x-9} ${y1} H${x+9} V${y2-16} H${x+20} L${x} ${y2} L${x-20} ${y2-16} H${x-9}Z" fill="${C.ink}"/>`);}
function tag(x,y,label,color){t(x,y,label,17,color,true,500);}
function step(x,y,w,h,n,title){box(x,y,w,h,'white',C.ink,true);t(x+18,y+34,`Step ${n}`,24,C.ink,true);t(x+114,y+34,title,24,C.ink,true,w-130);}
function png(x,y,w,h,file){const b64=fs.readFileSync(path.join(here,'assets',file)).toString('base64');s.push(`<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" href="data:image/png;base64,${b64}"/>`);box(x,y,w,h,'none',C.line);}
function startAB(title,h){start(title,h);const at=s.indexOf('</defs>'),keep=s;s=[];hatchDefs();const defs=s;s=keep;s.splice(at,0,...defs);}
const ranks=[['第十講',.9045],['第十講',.8777],['第十講',.8764],['第十五講',.8657],['第十講',.8625],['第十二講',.858],['第八講',.8559],['第八講',.844],['第十講',.8423],['第八講',.8409],['第二講',.8402],['第二講',.8397],['第二講',.838],['第九講',.8361],['第八講',.8349]];

// Figure A: how a follow-up question finds course evidence (contextualQuestion → embedding → Atlas top-15).
const HA=1166;
startAB('學生的追問如何找到相關教材',HA);
// framing row: q → FocusFlow → C, with the question the figure answers
person(58,34,C.q);sym(118,40,'q',26,C.q);
png(142,16,371,87,'top-question.png');
arrow('M524 60 H566',C.ink);s.push(`<rect x="578" y="22" width="180" height="76" fill="url(#hk)" stroke="${C.ink}" stroke-width="2"/>`);png(598,40,140,39,'top-logo.png');
arrow('M770 60 H812',C.ink);stack(826,34,110,62,4,C.dp,C.d);t(840,60,'候選片段',16,C.d,true);sym(840,86,'C',22,C.d);t(862,86,'15 段',16,C.d);
t(400,146,'系統怎麼從 129 個教材片段中，找到跟這個追問有關的內容？',22,C.ink,true,660);
bigArrow(300,112,168);
// Step 1 — follow-up completion
step(20,176,1060,262,1,'問句脈絡補全');
sym(46,244,'H',24,C.q);t(70,244,'對話紀錄',16,C.muted);
bubble(46,254,410,40,'white',C.line,'right');t(60,280,'OpenCV 跟 YOLO 分別是什麼？兩者有什麼差異？',16,C.ink,false,390);
bubble(46,304,240,34,'white',C.line,'left');for(let i=0;i<2;i++)s.push(`<rect x="60" y="${315+i*9}" width="${190-i*60}" height="4" fill="${C.line}"/>`);
sym(46,378,'q',24,C.q);t(66,378,'學生追問',16,C.muted);
bubble(46,388,410,34,C.qp,C.q,'right');rich(60,411,[['那如果…依照',C.q],['剛才',C.q,true],['的教材比較…？',C.q]],16,390);
arrow('M470 330 H520',C.q);
box(532,280,170,100,'white',C.q);t(548,310,'系統依規則補全',18,C.q,true,150);lines(548,338,['「剛才」→','前一問的主題'],15,C.muted,20,150);
arrow('M712 330 H754',C.q);
box(766,232,294,190,C.qp,C.q);sym(782,262,'q′',24,C.q);t(812,262,'獨立問句',17,C.q,true);
lines(782,296,['課程中如果學生的設備沒有 GPU，'],17,C.ink,28,265);
rich(782,324,[['依照',C.ink],['OpenCV 跟 YOLO 分別',C.q,true],['的',C.ink]],17,265);
lines(782,352,['教材比較，應優先考慮哪個？','為什麼？'],17,C.ink,28,265);
arrow('M550 440 V466',C.q);
// Step 2 — one embedding model E on both sides
step(20,474,1060,318,2,'語意向量化');
box(38,524,572,218,'#fbfcfd',C.line,true);tag(54,550,'教材端：影片上傳時先做好',C.d);
stack(58,592,150,98,4,'white',C.d);lines(70,616,['如果你的設備沒有','GPU 的時候，我們','通常會利用…'],15,C.ink,21,130);t(70,684,'第十講 1:08',14,C.d,true);
sym(58,724,'D = {d_1, …, d_{129}}',21,C.d);
arrow('M240 642 H282',C.d);model(294,604,'E','hd',C.d);
arrow('M390 642 H420',C.d);for(let r=0;r<4;r++)vec(432,600+r*22,14,11,14,C.d,5+r*11);sym(432,724,'e_1, …, e_{129}',21,C.d);
box(628,524,434,218,'#fbfcfd',C.line,true);tag(644,550,'問句端：學生提問時',C.q);
box(646,596,120,92,C.qp,C.q);sym(662,628,'q′',24,C.q);lines(662,656,['獨立問句'],15,C.q,20,96);
arrow('M776 642 H806',C.q);model(818,604,'E','hq',C.q);
arrow('M914 642 H938',C.q);vec(948,616,9,11,52,C.q);sym(948,724,'v',24,C.q);t(966,724,'問句向量',15,C.q);
t(210,776,'兩邊用同一個 Embedding 模型 E，問句和教材才落在同一個向量空間、可以直接比對',18,C.ink,true,860);
arrow('M550 794 V820',C.d);
// Step 3 — course-scoped vector search
step(20,828,1060,318,3,'課程內向量檢索');
vec(46,882,9,11,34,C.q);sym(154,906,'v',22,C.q);arrow('M176 899 H304 V970',C.q);
db(40,930,222,132);t(60,992,'課程知識庫',18,C.d,true);lines(60,1020,['15 支影片','129 個片段向量'],15,C.d,22,190);

arrow('M264 996 H278',C.d);s.push(`<circle cx="304" cy="994" r="17" fill="white" stroke="${C.d}" stroke-width="3"/><line x1="316" y1="1006" x2="328" y2="1018" stroke="${C.d}" stroke-width="4" stroke-linecap="round"/>`);t(286,1046,'比對',15,C.d,true);arrow('M324 994 H340',C.d);
const bx=404,base0=1048,top=898,lo=.83,hi=.91,yv=v=>base0-(v-lo)/(hi-lo)*(base0-top);
s.push(`<line x1="${bx-12}" y1="${base0}" x2="1060" y2="${base0}" stroke="${C.line}" stroke-width="1.5"/><line x1="${bx-12}" y1="${top-8}" x2="${bx-12}" y2="${base0}" stroke="${C.line}" stroke-width="1.5"/>`);
for(const v of [.83,.87,.91])t(bx-58,yv(v)+6,v.toFixed(2),15,C.muted);
t(bx-58,top-16,'相似度',15,C.muted);
ranks.forEach(([title,v],i)=>{const x=bx+i*44,top10=title==='第十講';s.push(`<rect x="${x}" y="${yv(v)}" width="30" height="${base0-yv(v)}" fill="${top10?C.d:C.dp}" stroke="${C.d}" stroke-width="1.2"/>`);
  t(x+(i<9?6:0),base0+22,`S${i+1}`,16,C.d,top10);t(x+15-(title.length-1)*7.5,base0+44,title.slice(1),15,C.muted);});
sym(bx-58,base0+80,'C',22,C.d);t(bx-42,base0+80,'：相似度前 15 名',16,C.d,true,300);

const figures=[save('01-question-to-evidence-v3-0','學生的追問如何找到相關教材',HA)];

// Figure B: how candidate evidence becomes a cited answer (answerGeneration → citations → StudentCourses).
const HB=1310;
startAB('候選片段如何變成有來源的回答',HB);
box(30,24,150,70,C.qp,C.q);sym(44,52,'q′',22,C.q);t(72,52,'獨立問句',15,C.q,true);t(44,80,'沒有 GPU 選哪個？',14,C.ink,false,130);
stack(196,30,122,64,4,C.dp,C.d);sym(208,56,'C',22,C.d);t(230,56,'15 個候選',15,C.d,true);t(208,82,'S1 … S15',14,C.ink);
arrow('M346 60 H388',C.ink);s.push(`<rect x="400" y="22" width="180" height="76" fill="url(#hk)" stroke="${C.ink}" stroke-width="2"/>`);png(420,40,140,39,'top-logo.png');
arrow('M592 60 H634',C.ink);sym(646,68,'A',24,C.a);png(666,36,205,48,'top-answer.png');t(666,106,'回答',15,C.a,true);
sym(882,68,'R',24,C.d);png(902,36,174,48,'top-citation.png');t(902,106,'來源（第 1 張卡片）',15,C.d,true,178);
t(400,146,'系統怎麼確定回答真的出自〈第十講〉1:08，而不是模型自己編的？',22,C.ink,true,670);
bigArrow(300,112,168);
// Step 1 — evidence-ID prompt
step(20,176,640,330,1,'證據編號提示');
t(40,240,'第十講',16,C.d,true,200);
timeline(40,278,600,'candidates');
s.push(`<path d="M40 346 H600 L620 366 V496 H40Z" fill="${C.dp}" stroke="${C.d}" stroke-width="1.5"/><path d="M600 346 V366 H620" fill="none" stroke="${C.d}" stroke-width="1.5"/>`);
sym(52,374,'P',22,C.d);t(74,374,'提示',16,C.d,true);
lines(56,400,['S5｜第十講 0:00–0:12　S3｜0:12–0:32　S2｜0:32–0:44','S1｜第十講 1:08–1:26「如果你的設備沒有 GPU 的時候…」','S9｜第十講 1:38–1:57　…其他 5 支影片的 10 段','規則：只依證據回答，並回報採用的證據編號'],15,C.ink,24,550);
// Step 2 — answer generation (side by side with Step 1)
step(676,176,404,330,2,'回答生成');
s.push(`<path d="M698 244 h52 l14 14 v68 h-66z" fill="${C.dp}" stroke="${C.d}" stroke-width="1.5"/>`);sym(716,292,'P',22,C.d);
arrow('M774 286 H806',C.d);model(818,250,'LLM','ha',C.a);t(906,292,'Gemini',15,C.a);
arrow('M860 338 V352',C.a);
box(696,356,366,118,C.ap,C.a);sym(710,384,'A',21,C.a);lines(734,384,['如果學生的設備沒有 GPU，應優','先考慮使用 OpenCV…'],15,C.ink,22,316);
sym(710,452,'Σ = {S1, S2, S3}',22,C.a);t(880,452,'採用的編號',15,C.a,true);

arrow('M550 508 V532',C.a);
// Step 3 — citation check
step(20,540,1060,196,3,'引用檢查');
sym(40,624,'Σ',24,C.a);chip(70,600,58,'S1',C.ap,C.a,C.a,19);chip(134,600,58,'S2',C.ap,C.a,C.a,19);chip(198,600,58,'S3',C.ap,C.a,C.a,19);
lines(40,660,['✓ 格式正確','✓ 每個編號都在 C 之中'],16,C.a,24,230);
arrow('M264 616 H292',C.a);t(300,652,'第十講',16,C.d,true);timeline(360,630,470,'adopted');
arrow('M842 646 H866',C.a);box(878,592,184,116,C.dp,C.d);sym(892,620,'R',22,C.d);t(914,620,'可播放的來源',15,C.d,true);lines(892,648,['第十講 1:08–1:26','第十講 0:32–0:44','第十講 0:12–0:32'],15,C.ink,20,160);

arrow('M550 738 V762',C.a);
// Step 4 — real screenshots: answer with citation cards → player at 1:08
step(20,770,1060,520,4,'影片時間定位');
const aw=248,ah=Math.round(721*aw/428),ax=56,ay=826;png(ax,ay,aw,ah,'screen-answer.png');

const cy=ay+Math.round(372*aw/428);s.push(`<rect x="${ax+6}" y="${cy-18}" width="${aw-12}" height="54" rx="6" fill="none" stroke="${C.a}" stroke-width="3"/>`);
const pw=470,ph=Math.round(390*pw/498),px=432,py=850;
arrow(`M${ax+aw} ${cy+8} H${px-6}`,C.a);t(ax+aw+14,cy-30,'點選',15,C.a,true,110);t(ax+aw+14,cy-10,'1:08–1:26',15,C.a,true,110);
png(px,py,pw,ph,'screen-player.png');


person(1010,py+120,C.a);

figures.push(save('02-evidence-to-answer-v3-0','候選片段如何變成有來源的回答',HB));

// Figure C: U-shaped loop after reference figure 2 — from students' questions back to the same students.
// Data: shortscripts 6aad16e2286cd9364737111a (selectionReason, sourceQuestions, evidence, versions[0].payload.shots)
// and shortassets 6aad1735286cd93647371149 (disclosure, youtubeUpload, review, publishedAt 2026-09-18).
const RED='#b3261e';
function sec(x,y,label){s.push(`<text x="${x}" y="${y}" font-size="21" fill="${RED}" font-weight="700" font-style="italic" data-max-width="440">${esc(label)}</text>`);}
function blob(x,y,w,h,color,fill='white',dash=false){s.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="26" fill="${fill}" stroke="${color}" stroke-width="2.4"${dash?' stroke-dasharray="7 5"':''}/>`);}
function thickUp(x,y1,y2,color){s.push(`<path d="M${x-7} ${y1} V${y2+26} H${x-18} L${x} ${y2} L${x+18} ${y2+26} H${x+7} V${y1}Z" fill="${color}"/>`);}
function miniTimeline(x,y,w,label,dur,segs,hits){t(x-78,y+16,label,15,C.d,true,72);const sx=v=>x+v/dur*w;
  segs.forEach(([a,b])=>{const hit=hits.some(([h1])=>Math.abs(h1-a)<.01);s.push(`<rect x="${sx(a)+.6}" y="${y}" width="${Math.max(sx(b)-sx(a)-1.2,1)}" height="22" rx="2" fill="${hit?C.d:'white'}" stroke="${hit?C.d:C.line}" stroke-width="1.2"/>`);});}
const L8=[[0,13.06],[13.06,26.12],[26.12,35.06],[35.06,44.54],[44.54,51.2],[51.2,63.74],[63.74,72.96],[72.96,82.68],[82.68,93.18],[93.18,106.74],[106.74,117.5],[117.5,120.06]];
const L15=[[0,11.26],[11.26,22.86],[22.86,34.74],[34.74,44.94],[44.94,52.66],[53.62,64.9],[64.9,73.38],[73.38,85.34],[85.34,98.38],[98.38,108.94],[108.94,117.42],[117.42,119.82]];
const K8=[[44.54],[51.2]],K10=[[0],[12.62],[32.12],[56.98],[68.6],[86.8],[98.64]],K15=[[53.62],[64.9],[73.38]];
const HC=1172;
start('反覆出現的提問如何變成複習短影音',HC);
t(176,44,'學生反覆問的問題，怎麼變成同一門課的學生都能看的複習短影音？',22,C.ink,true,900);
// left column: the same students at both ends of the loop
box(20,70,132,1080,'#fbfcfd',C.d);
person(86,110,C.q);t(56,210,'學生',18,C.q,true);lines(34,236,['網頁／LINE','提問'],15,C.q,20,110);
thickUp(86,1004,300,C.a);
person(86,1020,C.a);t(40,1118,'看到複習',16,C.a,true,100);t(40,1140,'短影音',16,C.a,true,100);
arrow('M154 160 H168',C.q);
// A — accumulated questions (questions collection); colour marks which cluster each ends up in
box(172,70,432,362,'white',C.ink);sec(190,104,'A　累積提問紀錄');sym(372,104,'Q',22,C.q);
const qs=[['open cv 跟 yolo 的關係是甚麼?',7,1],['openCV 是什麼?',null,0],['OpenCV跟YOLO有什麼差異',4,1],['YOLO跟opencv的具體差異是什麼？',4,1],['YOLO是什麼？',null,0],['OpenCV 跟 YOLO 分別是什麼？兩者有什麼差異？',3,1],['OpenCV跟yolo分別是什麼???',1,1],['opencv與yolo的差異',1,1]];
qs.forEach(([q,n,mine],i)=>{const y=122+i*36;box(190,y,398,30,mine?C.qp:'#f3f5f7',mine?C.q:C.line);t(202,y+21,q,15,mine?C.ink:C.muted,false,350);if(n)t(556,y+21,`×${n}`,15,C.q,true);});
arrow('M606 250 H618',C.ink);
// B — merge synonymous questions, rank by askers then counts; teacher picks the topic
box(620,70,460,362,'white',C.ink);sec(638,104,'B　同義題合併與熱度排序');sym(900,104,'G',22,C.q);
blob(638,120,424,150,C.q,C.qp);t(656,150,'open cv 跟 yolo 的關係是甚麼?',17,C.ink,true,300);
[7,4,4,3,1,1].forEach((n,i)=>{box(656+i*52,166,44,34,'white',C.q);t(666+i*52+(n>9?0:4),189,`×${n}`,15,C.q,true);});
t(656,228,'6 種問法合併・共 20 次・1 人',16,C.ink,false,380);t(656,254,'系統排名第 2，由教師選定',16,C.q,true,380);
s.push(`<path d="M1030 132 l6 13 14 2 -10 10 2 14 -12 -7 -12 7 2 -14 -10 -10 14 -2z" fill="${C.q}"/>`);
blob(638,284,196,70,C.d);t(652,312,'openCV 是什麼?',15,C.ink,true,170);t(652,338,'24 次・2 人・排名 1',14,C.d,false,170);
blob(846,284,104,70,C.line);t(858,312,'YOLO是什麼？',13,C.ink,true,90);t(858,338,'4 次',14,C.muted);
blob(960,284,102,70,C.line);t(974,312,'執行邏輯',14,C.ink,true,80);t(974,338,'4 次',14,C.muted);

arrow('M850 434 V450',C.ink);
// C — freeze evidence, generate an 8-shot script that cites the evidence
box(560,452,520,432,'white',C.ink);sec(578,486,'C　凍結證據、生成 8 拍腳本');sym(876,486,'K',22,C.d);sym(906,486,'S',22,C.a);
miniTimeline(660,506,398,'第八講',120.06,L8,K8);miniTimeline(660,538,398,'第十講',120.22,L10,K10);miniTimeline(660,570,398,'第十五講',119.82,L15,K15);
t(582,620,'K：凍結的 12 段證據',16,C.d,true,480);
model(580,666,'LLM','ha',C.a);arrow('M672 708 H690',C.a);
const shots=[['1 鉤子','偵測一定要','用YOLO？'],['2 情境','第一步通常','是OpenCV'],['3 揭露','兩者都有','偵測功能'],['4 反轉','不一定要','殺雞用牛刀'],['5 證據','YOLO運算','需要GPU'],['6 高潮','OpenCV用','CPU免訓練'],['7 結論','不需殺雞','用牛刀'],['8 收尾','沒GPU時','你選哪一個？']];
shots.forEach(([role,l1,l2],i)=>{const x=700+(i%4)*94,y=648+Math.floor(i/4)*92;box(x,y,88,84,'white',C.a);s.push(`<rect x="${x}" y="${y}" width="88" height="24" rx="6" fill="${C.ap}" stroke="${C.a}" stroke-width="1.5"/>`);t(x+8,y+17,role,13,C.a,true,74);lines(x+7,y+46,[l1,l2],13,C.ink,19,80);});

arrow('M558 690 H546',C.ink);
// D — teacher produces the video outside FocusFlow, then disclosure, review and publication
box(172,452,370,698,'white',C.ink);sec(190,486,'D　教師製作、審核後上架');sym(454,486,'M',22,C.a);
box(190,504,334,96,C.qp,C.q,true);t(206,532,'系統外製作影片',17,C.q,true,300);lines(206,558,['ComfyUI + MiniMax（地端模型）','在指導教授主機執行，未與系統串接'],14,C.ink,20,305);
arrow('M357 602 V618',C.q);
box(190,622,334,44,'white',C.d);t(206,650,'上傳成品 → YouTube（unlisted）',15,C.ink,false,305);
arrow('M357 668 V682',C.d);
box(190,686,334,44,'white',C.d);t(206,714,'✓ AI 揭露標示　✓ 數位分身書面同意',15,C.ink,false,305);
arrow('M357 732 V746',C.d);
box(190,750,334,44,C.ap,C.a);t(206,778,'成品審核通過 → 上架到教學短片牆',15,C.a,true,305);
arrow('M300 796 V814',C.a);
const shotsFile=path.join(here,'assets','screen-shorts.png');
if(fs.existsSync(shotsFile)){png(196,818,186,316,'screen-shorts.png');}else{box(196,818,186,316,'#f6f7f8',C.line,true);t(222,980,'學生端截圖待補',15,C.muted);}

arrow('M170 1076 H156',C.a);

figures.push(save('03-learning-feedback-v3-0','反覆出現的提問如何變成複習短影音',HC));

const gallery=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>FocusFlow 第三版圖稿</title><style>body{font-family:"Microsoft JhengHei",sans-serif;background:#edf1f4;color:#203442;margin:0;padding:32px}main{max-width:1120px;margin:auto}h1{font-size:27px}section{background:white;padding:24px;margin:28px 0}img{width:100%;height:auto}a{color:#286a9a}p{line-height:1.8}nav a{margin-right:20px}</style><main><h1>FocusFlow：問題如何轉成有來源的回答</h1><p>v3.0 審閱版。圖一、圖二是兩張獨立的圖，共用正式環境同一筆真實網頁追問紀錄（2026-09-27）：圖一呈現追問如何找到教材，圖二呈現候選片段如何變成有來源的回答；僅向量色塊為示意。圖三以同一門課一支已上架的真實短影音（2026-09-18）說明反覆出現的提問如何變成複習短影音。</p>${figures.map((f,i)=>`<section><h2>圖 ${i+1}　${f.title}</h2><p>${['學生追問「那如果學生的設備沒有 GPU…應優先考慮哪個？」後，系統如何補足問題並在課程中找到候選片段。','15 個候選片段如何組成提示、由模型作答，並只把採用的片段呈現為可跳轉的來源。','學生的提問經同義題合併與排序後由教師選題，系統凍結證據生成 8 拍腳本，教師在系統外製作影片，審核後上架回到同一門課的學生。'][i]}</p><nav><a href="${f.name}.svg">SVG</a><a href="${f.name}.png">PNG</a><a href="${f.name}.pdf">PDF</a><a href="${f.name}.html">獨立 HTML</a></nav><img src="${f.name}.svg" alt="${f.title}"><p>資料來源：本研究依 FocusFlow 程式碼與規格整理繪製。圖號為審閱用，尚未編入手冊。</p></section>`).join('')}</main></html>`;
fs.writeFileSync(path.join(output,'index-v3-0.html'),gallery);
const sourceFiles=['backend/src/services/qa.service.js','backend/src/services/answerGeneration.service.js','backend/src/services/contextualQuestion.service.js','backend/src/services/conversation.service.js','backend/src/services/queryEmbedding.service.js','backend/src/services/shortScriptTopic.service.js','backend/src/services/shortScript.service.js','backend/src/services/shortAssetPublish.service.js','backend/src/config/env.js','frontend/focus-flow/src/pages/StudentCourses.jsx','STT_Whisper/src/main.py','STT_Whisper/src/chunk_strategy.py','STT_Whisper/src/embedding.py'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const preservation={};for(const v of ['v1-0','v2-0'])for(const f of fs.readdirSync(path.join(base,'results',v)))preservation[`results/${v}/${f}`]=hash(fs.readFileSync(path.join(base,'results',v,f)));
const manifest={version:'v3.0',example:{figuresAB:'Real production web follow-up: questions 6ab8d5ddd2df5d6e221eb8b7, conversation 6ab8d58ed2df5d6e221eb8a0, course 69fb4d4c069e21f4e65b74dc, video 6a02f38c17c615e872035b94 (read-only MCP query, 2026-09-27). Embedding colour strip is illustrative.',figureC:'Real production records: shortscripts 6aad16e2286cd9364737111a, shortassets 6aad1735286cd93647371149 (read-only MCP query, 2026-09-27).'},figures,sourceFiles:Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))])),previousResults:preservation,assets:Object.fromEntries(fs.readdirSync(path.join(here,'assets')).map(n=>[n,hash(fs.readFileSync(path.join(here,'assets',n)))])),screenshots:'Captured 2026-09-27 from https://focusflow.ntub.edu.tw (Demo Student) via Windows screen capture; screen-answer.png stitches 4 consecutive scroll captures of the chat list (offset-verified, scrollbar cropped); screen-shorts.png is a screenshot supplied by the user in chat (2026-09-27) of the same short playing on the student shorts wall; top-question/top-answer/top-citation are crops of screen-answer.png; top-logo is a crop of the same-session full-screen capture.',source:hash(fs.readFileSync(fileURLToPath(import.meta.url))),usesImageGeneration:false};
fs.writeFileSync(path.join(records,'manifest-v3-0.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(figures));
