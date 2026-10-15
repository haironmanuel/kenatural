import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {demoGyms,validateFeed} from './data.js';
const root=resolve('public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(path==='/api/gyms'){
    if(!process.env.GYM_DATA_URL) return json(res,200,{mode:'demo',gyms:demoGyms});
    try{
      const url=new URL(process.env.GYM_DATA_URL);
      if(url.protocol!=='https:') throw new Error('Se requiere HTTPS');
      const upstream=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:process.env.GYM_DATA_TOKEN?{Authorization:`Bearer ${process.env.GYM_DATA_TOKEN}`}:{}});
      if(!upstream.ok) throw new Error('Fuente no disponible');
      const body=await upstream.text();
      if(body.length>2_000_000) throw new Error('Respuesta demasiado grande');
      return json(res,200,{mode:'live',gyms:validateFeed(JSON.parse(body))});
    }catch{return json(res,502,{error:'No pudimos consultar la fuente de ocupación. Intenta de nuevo en unos momentos.'});}
  }
  try{
    const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!file.startsWith(root+'/')){res.writeHead(403);return res.end();}
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Cache-Control':'no-cache'});res.end(content);
  }catch{res.writeHead(404);res.end('No encontrado');}
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`GymHora RD: puerto ${process.env.PORT||3000}`));
