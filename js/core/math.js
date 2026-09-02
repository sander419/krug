// file: js/core/math.js
// Чистое математическое ядро. Единицы: мм, граммы.
import * as THREE from 'three';
import { byId, density } from '../config/materials.js';
import { revision } from './bus.js';
import { partsVolumeMl, partsWarnings, fillLevelY, fillLimitedBy } from './parts.js';
import { sanitizeLid, lidMetrics, lidWarnings } from './lid.js';
import { sanitizePattern, patternOn, patternVolumeMl, patternWarnings, patternAreaMM2,
         patternUnderParts } from './pattern.js';

export const N_SAMP = 90;
const G_N = 1e-6 * 9.81; // плотность г/см³ → Н/мм³

function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function seededForm(seed){
  const rnd = mulberry32(seed);
  const n = 5 + Math.floor(rnd()*3);
  const pts = [];
  for(let i=0;i<n;i++){
    let r = i===0 ? .35+rnd()*.4 : i===n-1 ? .3+rnd()*.5 : .45+rnd()*.55;
    pts.push({t:i/(n-1), r});
  }
  pts[1+Math.floor(rnd()*(n-2))].r = 1;
  if(rnd()<.6 && n>4) pts[n-2].r = .22+rnd()*.3;
  return pts;
}

export function sampleProfile(pts, n=N_SAMP){
  const sorted=[...pts].sort((a,b)=>a.t-b.t);
  const curve=new THREE.SplineCurve(sorted.map(p=>new THREE.Vector2(Math.max(0,p.r),p.t)));
  const sm=curve.getPoints(n);
  for(const s of sm){ s.x=Math.max(0,s.x); s.y=THREE.MathUtils.clamp(s.y,0,1); }
  sm[0].set(Math.max(0,sorted[0].r),0);
  sm[n].set(Math.max(0,sorted[sorted.length-1].r),1);
  return sm;
}

/* Выборка профиля в миллиметрах. Зависит только от рецепта, поэтому считается
   один раз на правку: за кадр её просят геометрия, масса, прочность и чертёж,
   а сплайн на 90 точек — самая дорогая операция ядра. */
let profCache=null, profKey='';
export function userProfileMM(state){
  const key=revision()+'|'+state.H+'|'+state.D+'|'+state.points.length;
  if(profCache && profKey===key) return profCache;
  const sm=sampleProfile(state.points);
  const maxR=Math.max(1e-6,...sm.map(s=>s.x));
  profCache=sm.map(s=>({r:s.x/maxR*state.D/2, y:s.y*state.H}));
  profKey=key;
  return profCache;
}

export function radiusAt(samples,y){
  for(let i=1;i<samples.length;i++){
    if(samples[i].y>=y){
      const a=samples[i-1],b=samples[i];
      const k=(b.y-a.y)<1e-6?0:(y-a.y)/(b.y-a.y);
      return a.r+(b.r-a.r)*k;
    }
  }
  return samples[samples.length-1].r;
}

const frustum=(a,b,dy)=>Math.PI*dy*(a*a+a*b+b*b)/3;

export function floorY(state){
  return Math.min(Math.max(state.wall, state.footH>0?state.footH+1.5:0), state.H*.6);
}

/* масса, отходы, устойчивость */
/**
 * Поправка объёма от следов гончара, см³.
 *
 * Кольца от пальцев складываются с радиусом по той же формуле, что в
 * `js/core/geometry.js`, и в объём радиус входит квадратом: среднее смещение
 * нулевое, а объём растёт. Величина небольшая, но она есть и в STL.
 */
export function ringsVolumeMl(state, out){
  const amp=+state.rings||0;
  if(amp<=0||!out||out.length<2) return 0;
  const H=out[out.length-1].y;
  let sum=0;
  for(let i=1;i<out.length;i++){
    const dy=out[i].y-out[i-1].y;
    if(dy<=0) continue;
    const y=(out[i].y+out[i-1].y)/2, r=(out[i].r+out[i-1].r)/2;
    const fade=Math.max(0,Math.min(1,Math.min(y,H-y)/7));
    const d=amp*fade*Math.sin(y*Math.PI*2/4.2+0.5);
    sum+=Math.PI*((r+d)*(r+d)-r*r)*dy;
  }
  return sum/1000;
}

/**
 * Контур подрезанной ножки — те самые точки, по которым строится сетка.
 *
 * Ножку подрезают конусом с площадкой: с оси вверх на высоту ножки, наружу
 * до площадки, вниз по фаске и на пятку. Раньше объём этой выемки считался
 * отдельной формулой с множителем 0,65 «на глаз» — и расходился с сеткой
 * на 2,3 % массы там, где ножка есть. Теперь контур один и на модель,
 * и на массу.
 *
 * @param cut доля подрезки: в «Кинотеатре» ножка появляется постепенно
 */
export function footContour(baseR, footH, footK, cut=1){
  if(!(footH>0)) return [];
  // 0.15 мм остаётся всегда: нулевая ножка слепила бы точки в одну
  const fh=footH*cut+0.15, fk=footK/100;
  return [
    {r:0.01, y:0}, {r:0.01, y:fh},
    {r:Math.max(baseR*fk*0.85,0.5), y:fh},
    {r:baseR*fk, y:fh*0.5},
    {r:baseR, y:0.2},
  ];
}

/**
 * Объём выемки под ножкой, мм³ — по теореме Гульдина над тем же контуром,
 * которым режется сетка: ∮ r²/2 dy по замкнутому обходу выемки.
 */
export function footRecessMM3(baseR, footH, footK){
  const pts=footContour(baseR, footH, footK);
  if(!pts.length) return 0;
  // замыкаем контур по пятке: (baseR,0.2) → (baseR,0) → (0.01,0)
  const loop=pts.concat([{r:baseR, y:0}]);
  let v=0;
  for(let i=0;i<loop.length;i++){
    const a=loop[i], b=loop[(i+1)%loop.length];
    v += (a.r*a.r + a.r*b.r + b.r*b.r)/6 * (b.y-a.y);   // точный интеграл r²/2 dy на отрезке
  }
  return Math.abs(v*2*Math.PI);
}

export function computeProduction(state){
  const out=userProfileMM(state);
  const wall=state.wall, footOn=state.footH>0;
  const baseR=out[0].r;
  let vOut=0;
  for(let i=1;i<out.length;i++) vOut+=frustum(out[i-1].r,out[i].r,out[i].y-out[i-1].y);
  let vCav=0, vFill=0;
  const yFill=fillLevelY(out, state.parts);   // самый низкий носик режет уровень налива
  if(state.hollow){
    const floor=floorY(state);
    const inn=[];
    for(const o of out) if(o.y>=floor) inn.push({r:Math.max(o.r-wall,0),y:o.y});
    if(inn.length){
      const r0=Math.max(radiusAt(out,floor)-wall,0);
      if(inn[0].y>floor) inn.unshift({r:r0,y:floor});
      for(let i=1;i<inn.length;i++){
        const seg=frustum(inn[i-1].r,inn[i].r,inn[i].y-inn[i-1].y);
        vCav+=seg;
        if(inn[i-1].y>=yFill) continue;
        if(inn[i].y<=yFill){ vFill+=seg; continue; }
        const k=(yFill-inn[i-1].y)/Math.max(inn[i].y-inn[i-1].y,1e-9);
        const rMid=inn[i-1].r+(inn[i].r-inn[i-1].r)*k;
        vFill+=frustum(inn[i-1].r,rMid,yFill-inn[i-1].y);
      }
    }
  }
  /* Выемка под ножкой считается по тому же контуру, по которому она режется
     в сетке: прежняя формула с множителем 0,65 расходилась с выгруженной
     моделью на 2,3 % массы. */
  const vRec = footOn ? footRecessMM3(baseR, state.footH, state.footK) : 0;
  const partsMl=partsVolumeMl(out, state.parts);
  /* Крышка — отдельная деталь, но глину на неё берут из того же куска и обжигают
     в той же садке. В объём изделия она входит, в его вместимость — нет. */
  const lid=sanitizeLid(state.lid);
  const lidMl=lid.on?lidMetrics(out,lid,wall,1,byId(state.mat).shrinkPct,state.pattern).volMl:0;
  /* Рельеф узора считается отдельно и честно: в объём радиус входит квадратом,
     поэтому «как у гладкой» врало бы на проценты массы даже там, где средний
     радиус не изменился. */
  const patMl=patternVolumeMl(sanitizePattern(state.pattern), out);
  /* Следы гончара — тоже рельеф: они меняют модель и уезжают в STL, значит
     обязаны быть и в массе. Пока их считали «только видом», выгруженная
     вещь весила не столько, сколько обещал инструмент. */
  const ringMl=ringsVolumeMl(state, out);
  const vPiece=Math.max(0,vOut-vCav-vRec)/1000 + partsMl + lidMl + patMl + ringMl;  // см³, вместе с прилепами и крышкой
  const massF=vPiece*density(byId(state.mat));               // г
  const massN=massF*(1+state.allow/100);
  let areaSum=0,ySum=0;
  for(let i=1;i<out.length;i++){
    const ro1=out[i-1].r,ro2=out[i].r;
    const ri1=state.hollow?Math.max(ro1-wall,0):0;
    const ri2=state.hollow?Math.max(ro2-wall,0):0;
    const a=(ro1*ro1+ro2*ro1+ro2*ro2)/3-(ri1*ri1+ri2*ri1+ri2*ri2)/3;
    const ym=(out[i-1].y+out[i].y)/2;
    // вклад пояска пропорционален его высоте: шаг выборки по профилю неравномерный,
    // без dy центр масс уезжает вверх и устойчивость выходит заниженной
    const dy=out[i].y-out[i-1].y;
    areaSum+=a*dy;ySum+=a*dy*ym;
  }
  const yCom=areaSum>0?ySum/areaSum:state.H/2;
  const angle=Math.atan2(baseR,Math.max(yCom,1))*180/Math.PI;
  return {massF,massN,waste:massN-massF,volMl:vPiece,capMl:vCav/1000,
          fillMl:(state.hollow?vFill:0)/1000, cutBySpout:yFill<out[out.length-1].y-0.5,
          fillBy:fillLimitedBy(out,state.parts),
          angle,baseR,partsMl,lidMl};
}

/* запас прочности по пределу текучести (упрощённая модель осадки) */
export function computeStrength(state){
  const out=userProfileMM(state);
  const wall=state.wall, rho=density(byId(state.mat));
  /* Площадь сечения считается вместе с рельефом: гребни добавляют материал,
     ложбины убирают, и в сумме сечение чуть больше гладкого. Считать «как
     у гладкой» значило бы занижать запас там, где узор его на самом деле
     прибавил, — а мы обещаем числа, а не осторожность. */
  const pat=sanitizePattern(state.pattern);
  const H=out[out.length-1].y;
  const area=out.map(o=>Math.PI*(o.r*o.r-(state.hollow?Math.pow(Math.max(o.r-wall,0),2):0))
    +(patternOn(pat)?patternAreaMM2(pat,o.r,o.y,H):0));
  const wAbove=new Array(out.length).fill(0);
  let acc=0;
  for(let i=out.length-1;i>0;i--){
    acc += area[i]*(out[i].y-out[i-1].y)*rho*G_N;
    wAbove[i-1]=acc;
  }
  // τᵧ задан в кПа, напряжение ниже — в Н/мм² (= МПа): 1 кПа = 1e-3 МПа.
  // Критерий Треска: предел на сжатие свежей пасты σc = 2·τᵧ.
  const sigmaC=state.pr.tau*2e-3;      // МПа = Н/мм²
  let minSF=9,minY=0;
  const sf=out.map((o,i)=>{
    const s=(area[i]>1 && wAbove[i]>1e-6)?sigmaC/(wAbove[i]/area[i]):9;
    const v=Math.min(s,9);
    if(v<minSF && o.y>2){minSF=v;minY=o.y;}
    return v;
  });
  return {sf, y:out.map(o=>o.y), minSF, minY};
}

// «где» для критического сечения: у самого дна писать «0 см» бессмысленно
export const atLevel=y=>y<10?'у основания':(y/10).toFixed(0)+' см';

/* Поле area у замечания — вкладка, без которой оно бессмысленно: интерфейс
   прячет такие замечания вместе с инструментом. Замечание без area показывают
   всегда — по умолчанию оно касается всех. */
export function computeWarnings(state, prod, str){
  const w=[];
  if(state.hollow && state.wall<3) w.push({lvl:'warn',help:'thinWall',txt:'Стенка тоньше 3 мм — порвётся при вытяжке.'});
  if(prod.angle<12) w.push({lvl:'bad',help:'unstable',txt:`Неустойчива: опрокинется уже при наклоне ${prod.angle.toFixed(0)}°. Расширьте основание.`});
  if(state.H/state.D>2.6) w.push({lvl:'warn',help:'tooTall',txt:'Форма слишком высокая относительно диаметра — сложно центровать.'});
  const out=userProfileMM(state);
  let over=0;
  for(let i=1;i<out.length;i++){
    const dy=out[i].y-out[i-1].y;
    if(dy>0.1 && (out[i].r-out[i-1].r)/dy < -1.35) over++;
  }
  if(over/(out.length-1)>.12) w.push({lvl:'warn',area:'print',help:'overhang',txt:'Нависающий профиль — глина оплывёт без поддержки.'});
  if(str.minSF<1.5) w.push({lvl:'bad',area:'print',help:'collapse',txt:`Печать: обрушение — запас прочности ${str.minSF.toFixed(1)}× ${atLevel(str.minY)}. Утолщите стенки, снизьте высоту или возьмите пасту жёстче.`});
  else if(str.minSF<2.5) w.push({lvl:'warn',area:'print',help:'slump',txt:`Печать: осадка вероятна — мин. запас ${str.minSF.toFixed(1)}× ${atLevel(str.minY)}. Проверьте τᵧ пасты.`});
  for(const pw of partsWarnings(state,out)) w.push(pw);
  /* Узор — часть формы, и его замечания идут в общий список: иначе мастер
     видит «всё чисто» на вещи, у которой в ложбине миллиметр стенки. */
  for(const pw of patternWarnings(sanitizePattern(state.pattern),
      {wall:state.wall, hollow:state.hollow, D:state.D, H:state.H,
       bead:(state.pr&&+state.pr.nozzle||4)*1.05, layerH:(state.pr&&+state.pr.lh)||0}))
    if(pw.lvl!=='ok') w.push({lvl:pw.lvl, ...(pw.area?{area:pw.area}:{}), help:'relief',
      txt:'Узор: '+pw.txt});
  const pt=sanitizePattern(state.pattern);
  if(patternOn(pt)){
    /* Глазурь на рельефе ведёт себя иначе, чем на гладкой стенке, а наш расчёт
       плёнки считает по сечению и про борозды не знает. Молчать об этом нельзя:
       на пробу уходит обжиг. */
    if(state.firing==='glaze')
      w.push({lvl:'warn', area:'glaze', help:'glaze-run',
        txt:'Узор и глазурь: на гребнях плёнка тоньше и может пробиться, в ложбинах — '
          +'копится и течёт. Расчёт толщины считает по гладкому сечению; первую вещь обожгите пробно.'});
    /* Прилеп, севший в ложбину, держится на её дне: площадь шва меньше,
       и отрывается он первым. Лечится поворотом детали или сдвигом слоя —
       поэтому в замечании сказано и то, и другое. */
    for(const u of patternUnderParts(pt, state.parts, state.H)){
      if(u.d > -0.35) continue;
      w.push({lvl: u.d < -1.2 ? 'bad' : 'warn', help: 'relief',
        txt: `Узор и прилепы: ${u.name} на ${u.az}° садится в ложбину глубиной `
          + `${Math.abs(u.d).toFixed(1)} мм — шов ляжет на её дно и оторвётся первым. `
          + 'Поверните деталь или сдвиньте слой по кругу.'});
    }
    /* Просвет — свойство черепка, а не рельефа: на красной глине тонкое дно
       окна просто станет хрупким местом. */
    if(pt.layers.some(l=>l.id==='window')){
      const m=byId(state.mat);
      const translucent=/фарфор|porcelain/i.test(m.name+' '+(m.id||''));
      if(!translucent)
        w.push({lvl:'warn', help:'choose-mass',
          txt:`Узор «Окна на просвет» светится только на просвечивающем черепке. `
            +`«${m.name}» на свету не пропустит — возьмите фарфор или считайте окна рельефом.`});
    }
  }
  for(const lw of lidWarnings(state,out,byId(state.mat))) w.push(lw);
  if(!w.length) w.push({lvl:'ok',txt:'Мастер одобряет: форма технологична и устойчива.'});
  return w;
}
