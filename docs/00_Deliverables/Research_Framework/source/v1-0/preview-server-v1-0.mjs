// Local-only renderer input. Serves this diagram, never the repository tree.
import http from 'node:http';
import fs from 'node:fs';
const file=new URL('../../results/v1-0/focusflow-research-framework-v1-0.html',import.meta.url);
http.createServer((req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(req.url!=='/'){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(fs.readFileSync(file));
}).listen(8794,'127.0.0.1',()=>console.log('http://127.0.0.1:8794 (Ctrl+C to stop)'));
