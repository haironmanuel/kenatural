import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {demoGyms,validateFeed} from './data.js';
import {fileURLToPath} from 'node:url';
import {createAuth} from './auth.js';
import {createStore} from './auth-store.js';
import {manualGym} from './manual-gyms.js';
import {LISTING_PLAN} from './subscriptions.js';
const root=resolve('public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
export function createApplication({store, production = false, publicOrigin, rateLimit} = {}) {
const auth = createAuth({store, production, publicOrigin, rateLimit});
return http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(await auth(req,res,path,json)) return;
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(path==='/api/listing-plan')return json(res,200,LISTING_PLAN);
  if(path==='/api/gyms'){
    let community=[],communityWarning;
    try{if(store)community=(await store.listPublicGyms()).map(manualGym);}
    catch{communityWarning='No pudimos consultar los gimnasios de la comunidad. Intenta de nuevo.';}
    if(!process.env.GYM_DATA_URL) return json(res,200,{mode:'demo',gyms:[...community,...demoGyms],warning:communityWarning});
    try{
      const url=new URL(process.env.GYM_DATA_URL);
      if(url.protocol!=='https:') throw new Error('Se requiere HTTPS');
      const upstream=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error',headers:process.env.GYM_DATA_TOKEN?{Authorization:`Bearer ${process.env.GYM_DATA_TOKEN}`}:{}});
      if(!upstream.ok) throw new Error('Fuente no disponible');
      const body=await upstream.text();
      if(body.length>2_000_000) throw new Error('Respuesta demasiado grande');
      const upstreamGyms=validateFeed(JSON.parse(body));
      const ids=new Set(community.map(g=>g.id));
      return json(res,200,{mode:'live',gyms:[...community,...upstreamGyms.filter(g=>!ids.has(g.id))],warning:communityWarning});
    }catch{
      if(community.length)return json(res,200,{mode:'live',gyms:community,warning:'La fuente automática no respondió. Solo se muestran reportes manuales.'});
      return json(res,502,{error:'No pudimos consultar la fuente de ocupación. Intenta de nuevo en unos momentos.'});
    }
  }
  try{
    const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!file.startsWith(root+'/')){res.writeHead(403);return res.end();}
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Cache-Control':'no-cache'});res.end(content);
  }catch{res.writeHead(404);res.end('No encontrado');}
});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const production = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  let store;
  try { store = await createStore({production}); }
  catch { console.warn('Cuentas no disponibles: configura una DATABASE_URL PostgreSQL válida. La exploración sigue disponible.'); }
  const app = createApplication({store, production, publicOrigin: process.env.PUBLIC_ORIGIN});
  app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`GymHora RD: puerto ${process.env.PORT||3000}`));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => {
    app.close(async () => { await store?.close(); process.exit(0); });
  });
}
