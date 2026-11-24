// PROTOTYPE, throwaway. Copied verbatim from prototype/cut-sheet-pdf/index.html (lines 63-190) so the
// labels use the same synthetic Job, Blank ids and Part numbers as the cut-sheet prototype.
// ============================================================ SETTINGS (Machine settings snapshot)
const S = { bed:1300, clamp:40, kerf:3.2, trim:0, bit:6, gap:12, jobShort:'KIT', jobName:'Kitchen run — 4 base cabinets',
  generated: new Date('2026-11-24T10:30:00') };
const USABLE = S.bed - 2*S.clamp;

// ============================================================ SYNTHETIC EXPORT (from cut-otimizer#5 facts)
const SHEETS = {
  W18:{ code:'W18', name:'White melamine 18', t:18, L:2800, W:2070, grain:'none' },
  O18:{ code:'O18', name:'Oak melamine 18',   t:18, L:2800, W:2070, grain:'length' },
  M8: { code:'M8',  name:'White MDF 8',       t:8,  L:2800, W:2070, grain:'none' },
};
const WB='White ABS 1×23', OB='Oak ABS 1×23';
const HUMAN = { leftSide:'Left side', rightSide:'Right side', bottom:'Bottom', frontRail:'Front rail', backRail:'Back rail',
  back:'Back', 's0.door.leaf[0]':'Door', 's0.shelf[0]':'Shelf' };
let pid = 0;
const parts = [];
function part(o){ // L along x, W along y. band: {x0,xL,y0,yW}
  const b = Object.assign({x0:null,xL:null,y0:null,yW:null}, o.band||{});
  const cutL = o.L - (b.x0?1:0) - (b.xL?1:0), cutW = o.W - (b.y0?1:0) - (b.yW?1:0);
  const p = Object.assign({ id:'p'+String(++pid).padStart(3,'0'), top:[], bottom:[], manual:[], saw:false }, o, { band:b, cutL, cutW });
  p.display = p.cab ? `${p.cab} · ${HUMAN[p.name]||p.name}` : p.item;
  p.group = p.cab || p.item.replace(/^.*?(B\d).*$/,'$1');
  parts.push(p); return p;
}
const drill=(x,y,d,z)=>({k:'drill',x,y,d,z}); // z null = through
const groove=(x,y,l,w,z)=>({k:'groove',x,y,l,w,z});
for (const [i,cab] of ['B1','B2','B3','B4'].entries()) {
  for (const name of ['leftSide','rightSide']) {
    const top=[]; for (let k=0;k<18;k++){ top.push(drill(120+k*32,37,5,12)); top.push(drill(120+k*32,493,5,12)); }
    top.push(drill(80,37,5,12), drill(690,37,5,12));
    top.push(groove(0,535.5,720,8.5,8));
    part({cab,name,sheet:'W18',L:720,W:560,band:{y0:WB},top});
  }
  const legs=[]; for (const [cx,cy] of [[60,60],[504,60],[60,500],[504,500]]) for (const [dx,dy] of [[0,0],[32,0],[0,32],[32,32]]) legs.push(drill(cx+dx-16,cy+dy-16,4,10));
  part({cab,name:'bottom',sheet:'W18',L:564,W:560,band:{y0:WB},top:[groove(0,535.5,564,8.5,8)],bottom:legs});
  part({cab,name:'frontRail',sheet:'W18',L:564,W:100});
  part({cab,name:'backRail',sheet:'W18',L:564,W:99});
  part({cab,name:'back',sheet:'M8',L:590,W:700,saw:true});
  const left = i<2, hy = left?22.5:595-22.5, dy = left?32:595-32, gy = left?595-40:40;
  part({cab,name:'s0.door.leaf[0]',sheet:'O18',L:717,W:597,band:{x0:OB,xL:OB,y0:OB,yW:OB},grain:'length',
    top:[drill(600,gy,4.5,null),drill(472,gy,4.5,null)],
    bottom:[drill(100,hy,35,13),drill(600,hy,35,13),drill(76,dy,8,11),drill(124,dy,8,11),drill(576,dy,8,11),drill(624,dy,8,11)]});
  part({cab,name:'s0.shelf[0]',sheet:'W18',L:563,W:540,band:{y0:WB}});
}
for (const [item,sh] of [['End Panel B1 start','O18'],['End Panel B2 start','W18'],['End Panel B2 end','W18'],['End Panel B3 start','W18'],['End Panel B3 end','W18'],['End Panel B4 end','O18']])
  part({item,name:'endPanel',sheet:sh,L:869,W:577,band:{y0:sh==='O18'?OB:WB,xL:sh==='O18'?OB:WB},grain:sh==='O18'?'length':null});
for (const [item,sh,L] of [['Toe Kick B1','O18',600],['Toe Kick B2','O18',1200],['Toe Kick B3','W18',600]])
  part({item,name:'toeKick',sheet:sh,L,W:150,band:{y0:sh==='O18'?OB:WB},grain:sh==='O18'?'length':null,saw:true});

// ============================================================ SIDE B FILES (exact-match grouping)
function bottomView(p){ // mirror about x axis, then rotate 180 if ops are nearer the far edges
  let ops = p.bottom.map(o=>({...o, y:p.cutW-o.y}));
  const my = ops.reduce((a,o)=>a+o.y,0)/ops.length, mx = ops.reduce((a,o)=>a+o.x,0)/ops.length;
  let rot = (my > p.cutW/2 && mx > p.cutL/2);
  if (my > p.cutW/2) { ops = ops.map(o=>({...o, x:p.cutL-o.x, y:p.cutW-o.y})); rot = true; }
  const fenceLong = rot ? 'y0' : 'yW', fenceShort = rot ? 'xL' : 'x0';
  return { ops, sig: p.cutL+'x'+p.cutW+'|'+ops.map(o=>[o.x,o.y,o.d,o.z].join(',')).sort().join(';'), fenceLong, fenceShort };
}
const sideB = []; // {id, parts, view}
for (const p of parts.filter(p=>p.bottom.length)) {
  const v = bottomView(p);
  let f = sideB.find(f=>f.view.sig===v.sig);
  if (!f) { f = { id:`${S.jobShort}-B${sideB.length+1}`, parts:[], view:v, sample:p }; sideB.push(f); }
  f.parts.push(p); p.sideB = f.id;
}

// ============================================================ NESTING (naive shelf packer) + BREAKDOWN (guillotine strips)
const blanks=[], boards=[];
function nestSheet(code){
  const sh = SHEETS[code];
  const list = parts.filter(p=>p.sheet===code && !p.saw).map(p=>{
    const free = !(sh.grain==='length' || p.grain==='length');
    const opts = [{rot:false,w:p.cutL,h:p.cutW}]; if (free) opts.push({rot:true,w:p.cutW,h:p.cutL});
    return { p, opts };
  }).sort((a,b)=>b.p.cutL*b.p.cutW-a.p.cutL*a.p.cutW);
  const out=[];
  for (const it0 of list) {
    let best=null; // best fit into an existing row: least height waste
    for (const bl of out) for (const row of bl.rows) for (const o of it0.opts)
      if (o.h<=row.h && row.x+o.w<=USABLE) { const waste=row.h-o.h; if (!best||waste<best.waste) best={bl,row,o,waste}; }
    if (best) { place(best.bl,best.row,{p:it0.p,...best.o}); continue; }
    let nr=null; // else a new row in an existing Blank, lowest row first
    for (const bl of out) { const ny = bl.rows.length ? bl.rows.at(-1).y+bl.rows.at(-1).h+S.gap : 0;
      for (const o of it0.opts) if (ny+o.h<=USABLE && o.w<=USABLE && (!nr||o.w<nr.o.w)) nr={bl,ny,o}; }
    if (nr) { const row={y:nr.ny,h:nr.o.h,x:0}; nr.bl.rows.push(row); place(nr.bl,row,{p:it0.p,...nr.o}); continue; }
    const o = it0.opts.reduce((a,b)=>b.w<a.w?b:a);
    const bl={sheet:code,rows:[],items:[]}; out.push(bl); const row={y:0,h:o.h,x:0}; bl.rows.push(row); place(bl,row,{p:it0.p,...o});
  }
  function place(bl,row,it){ bl.items.push({...it,x:row.x,y:row.y}); row.x+=it.w+S.gap; }
  for (const bl of out){ // shrink to used extent + clamp margin
    bl.w = Math.max(...bl.items.map(i=>i.x+i.w)) + 2*S.clamp;
    bl.h = Math.max(...bl.items.map(i=>i.y+i.h)) + 2*S.clamp;
  }
  // pieces for the Board: Blanks + Saw Parts
  const pieces = out.map(b=>({kind:'blank',b,w:b.w,h:b.h}))
    .concat(parts.filter(p=>p.sheet===code&&p.saw).map(p=>{const rot=sh.grain!=='length'&&p.grain!=='length'&&p.cutW>p.cutL; return {kind:'saw',p,w:rot?p.cutW:p.cutL,h:rot?p.cutL:p.cutW};}))
    .sort((a,b)=>b.h-a.h||b.w-a.w);
  const bds=[];
  for (const pc of pieces){
    let ok=false;
    for (const bd of bds){
      for (const st of bd.strips) if (pc.h<=st.h && st.x+pc.w<=sh.L-2*S.trim){ st.items.push({...pc,x:st.x}); st.x+=pc.w+S.kerf; ok=true; break; }
      if (ok) break;
      if (bd.y+pc.h<=sh.W-2*S.trim){ const st={y:bd.y,h:pc.h,x:pc.w+S.kerf,items:[{...pc,x:0}]}; bd.strips.push(st); bd.y+=pc.h+S.kerf; ok=true; break; }
    }
    if (!ok){ const bd={sheet:code,strips:[],y:pc.h+S.kerf}; bd.strips.push({y:0,h:pc.h,x:pc.w+S.kerf,items:[{...pc,x:0}]}); bds.push(bd); }
  }
  bds.forEach((bd,i)=>{
    bd.n=i+1; bd.of=bds.length; bd.id=`${code}-${bd.n}`; let letter=0; bd.cuts=[]; bd.offcuts=[]; bd.saws=[]; bd.blanks=[];
    bd.strips.forEach((st,si)=>{
      const rn = si+1; const last = si===bd.strips.length-1 && sh.W-(st.y+st.h)<1;
      bd.cuts.push({no:`${rn}`, dir:'Rip', set:st.h, ref: si===0?'front edge (Y0)':'cut edge of remainder', yields:`strip ${rn} · ${st.h.toFixed(1)} wide`});
      st.items.forEach((it,k)=>{
        if (it.kind==='blank'){ it.b.id=`${code}-${bd.n}-${String.fromCharCode(65+letter++)}`; it.b.board=bd; bd.blanks.push(it.b); blanks.push(it.b); it.label=it.b.id; it.b.pos={x:it.x,y:st.y}; }
        else { it.label=it.p.display; it.p.board=bd; bd.saws.push(it.p); it.p.loc=`${bd.id} saw`; }
        bd.cuts.push({no:`${rn}${String.fromCharCode(97+k)}`, dir:'Cross', set:it.w, ref: k===0?'left end of strip':'cut end', yields:`${it.label} · ${it.w.toFixed(0)}×${it.h.toFixed(0)}${it.h<st.h?` (+ rip ${it.h.toFixed(0)} from strip edge)`:''}`});
        if (it.h<st.h) bd.offcuts.push({x:it.x,y:st.y+it.h+S.kerf,w:it.w,h:st.h-it.h-S.kerf});
      });
      if (sh.L-st.x>1) bd.offcuts.push({x:st.x,y:st.y,w:sh.L-st.x,h:st.h});
    });
    if (sh.W-bd.y>1) bd.offcuts.push({x:0,y:bd.y,w:sh.L,h:sh.W-bd.y});
    bd.offcuts = bd.offcuts.filter(o=>o.w>5&&o.h>5);
    boards.push(bd);
  });
  out.forEach(bl=>bl.items.forEach((it,i)=>{ it.no=i+1; it.p.blank=bl; it.p.no=i+1; it.p.loc=`${bl.id} #${i+1}`; }));
}
['W18','O18','M8'].forEach(nestSheet);
blanks.sort((a,b)=>a.id.localeCompare(b.id));
