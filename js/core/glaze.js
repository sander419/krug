// file: js/core/glaze.js
// UMF (формула Зегера): флюсы = 1.0; оценка поверхности по Si:Al; прогноз CTE.
export function glazeCTE(g){
  return 5.0 + 0.45*g.si - 3.0*g.al + 1.5*(1-g.ca);
}
export function evaluateGlaze(g, bodyCTE){
  const ratio=g.si/g.al;
  const surface = ratio>=6.5 ? {t:'глянцевая',c:'ok'}
               : ratio>=4   ? {t:'сатиновая',c:'ok'}
               :              {t:'матовая',  c:'warn'};
  const cte=glazeCTE(g), d=cte-bodyCTE;
  const fit = Math.abs(d)<=0.7 ? {t:'ΔCTE согласован — глазурь и черепок работают вместе',c:'ok'}
            : d>0.7            ? {t:'ЦЕК: глазурь в растяжении — сетка микротрещин. Добавьте кремнезём или уберите щёлочь',c:'bad'}
            :                    {t:'ОТСКОК: глазурь в сильном сжатии — сколы кромок. Уменьшите кремнезём',c:'bad'};
  return {ratio, surface, cte, delta:d, fit};
}
