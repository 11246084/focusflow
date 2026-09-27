import http from 'node:http';
import fs from 'node:fs';
const pages={'/':'../../results/v2-0/focusflow-research-framework-v2-0.html','/chapter':'../../results/v2-0/chapter03-placement-v2-0.html'};
http.createServer((req,res)=>{if(req.url==='/favicon.ico'){res.writeHead(204);return res.end();}const f=pages[req.url];if(!f){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(new URL(f,import.meta.url)));}).listen(8795,'127.0.0.1',()=>console.log('Figure: http://127.0.0.1:8795 ; Chapter preview: /chapter'));
