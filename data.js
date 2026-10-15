export const cities = ['Santo Domingo', 'Santiago', 'Punta Cana', 'La Romana'];
const profiles = [
  [12,18,28,40,32,22,18,24,34,38,45,68,85,94,80,54,30],
  [8,15,35,48,34,20,16,22,30,36,48,75,92,88,72,42,20],
  [14,24,38,46,28,18,14,20,32,42,55,78,89,96,74,48,24]
];
export const demoGyms = [
  ['demo-1','Distrito Fitness','Santo Domingo','Piantini',120,profiles[0]],
  ['demo-2','Norte Training Club','Santiago','Los Jardines',90,profiles[1]],
  ['demo-3','Bávaro Active','Punta Cana','Bávaro',80,profiles[2]],
  ['demo-4','Zona Colonial Gym','Santo Domingo','Zona Colonial',60,profiles[1]],
  ['demo-5','Romana Strength','La Romana','Centro',75,profiles[0]],
  ['demo-6','Cibao Fitness Studio','Santiago','Villa Olga',65,profiles[2]]
].map(([id,name,city,area,capacity,profile],i)=>({id,name,city,area,capacity,people:[38,68,24,45,20,52][i],observedAt:null,
  hourly:profile.map((occupancy,j)=>({hour:j+6,occupancy})),source:'Ejemplo ficticio',demo:true}));

export function validateFeed(data) {
  if (!data || !Array.isArray(data.gyms) || data.gyms.length>1000) throw new Error('La fuente debe contener gyms (máximo 1000).');
  const ids = new Set();
  return data.gyms.map(g=>{
    for (const k of ['id','name','city','area']) if(typeof g[k]!=='string'||!g[k].trim()||g[k].length>160) throw new Error(`Campo inválido: ${k}`);
    if(ids.has(g.id)) throw new Error('ID duplicado'); ids.add(g.id);
    if(!Number.isInteger(g.capacity)||g.capacity<1||g.capacity>100000||!Number.isInteger(g.people)||g.people<0||g.people>100000) throw new Error('Conteo o capacidad inválidos');
    const time = Date.parse(g.observedAt);
    if(!Number.isFinite(time)||time>Date.now()+60000) throw new Error('observedAt inválido');
    const hours = new Set();
    if(!Array.isArray(g.hourly)||g.hourly.length>24||g.hourly.some(h=>!Number.isInteger(h.hour)||h.hour<0||h.hour>23||!Number.isFinite(h.occupancy)||h.occupancy<0||h.occupancy>100||hours.has(h.hour)||!hours.add(h.hour))) throw new Error('Historial horario inválido');
    if(typeof g.source!=='string'||!g.source.trim()||g.source.length>200) throw new Error('Fuente requerida');
    return {id:g.id,name:g.name,city:g.city,area:g.area,capacity:g.capacity,people:g.people,observedAt:new Date(time).toISOString(),hourly:[...g.hourly].sort((a,b)=>a.hour-b.hour),source:g.source,demo:false};
  });
}
