import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

// --- constants & utils ---
const ONE_DAY = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const COLORS = { shopHigh:'#16a34a', shopMed:'#f59e0b', shopLow:'#ef4444', shopGrey:'#9ca3af', delivery:'#2563eb' };

function excelSerialToDate(n){ const ms = EXCEL_EPOCH + Math.round(Number(n))*ONE_DAY; return new Date(ms); }
function toMonday(d){ const dd=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); const day=dd.getUTCDay(); const diff=(day+6)%7; dd.setUTCDate(dd.getUTCDate()-diff); return dd; }
function fmtISO(d){ return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }
function parseHeaderToDateKey(k){ if(k==null) return null; if(typeof k==='number') return fmtISO(toMonday(excelSerialToDate(k))); if(k instanceof Date && !isNaN(k)) return fmtISO(toMonday(k)); if(typeof k==='string'){ const s=k.replace(/\s+\d{2}:\d{2}:\d{2}$/,''); const d=new Date(s); if(!isNaN(d)) return fmtISO(toMonday(d)); } return null; }
function num(v){ const n=typeof v==='string'? parseFloat(v.replace(/,/g,'')) : Number(v); return isFinite(n)? n:0; }

function normalizeSheet(jsonRows){
  if(!jsonRows || !jsonRows.length) return { projectKey:'Project', long:[] };
  const first=jsonRows[0]||{}; const keys=Object.keys(first);
  const projectKey = keys.find(k=>String(k).toLowerCase().includes('project'))||'Project';
  const long=[];
  for(const row of jsonRows){
    const proj=String(row[projectKey]??'').trim(); if(!proj) continue;
    for(const k of Object.keys(row)){
      const iso=parseHeaderToDateKey(k); if(!iso) continue;
      const v=num(row[k]); if(!isFinite(v)) continue;
      if(v===0) continue;
      long.push({ project:proj, weekISO:iso, tons:v });
    }
  }
  return { projectKey, long };
}

// Number input that keeps focus; commits on blur/Enter
function NumberField({ value, placeholder, width='100%', onCommit }){
  const [val,setVal]=useState(value ?? '');
  useEffect(()=>{ setVal(value ?? ''); }, [value]);
  return (
    <input
      className="input"
      style={{width, border:'1px solid #d1d5db', borderRadius:8, padding:'4px 6px', fontSize:13, minWidth:60}}
      value={val}
      placeholder={placeholder}
      onChange={(e)=> setVal(e.target.value)}
      onBlur={()=>{ const raw = String(val).trim(); if(raw===''){ onCommit(''); return; } const n = Math.max(0, Number(raw.replace(/[^0-9.]/g,'')) || 0); onCommit(String(n)); }}
      onKeyDown={(e)=>{ if(e.key==='Enter'){ e.currentTarget.blur(); } if(e.key==='Escape'){ setVal(value ?? ''); e.currentTarget.blur(); }}}
    />
  );
}

function computeShopBuckets(projects, weekStarts, mapShop, confirmations){
  const buckets = weekStarts.map(()=> ({ High:0, Medium:0, Low:0, Unassigned:0 }));
  const keyShop = (proj,w)=> `Shop|${proj}|${w}`;
  for(const proj of projects){
    for(let i=0;i<weekStarts.length;i++){
      const w=weekStarts[i];
      const planned = mapShop.get(`${proj}|${w}`) || 0;
      const c = confirmations[keyShop(proj,w)] || { probCat:'', expected:'' };
      const expected = c && c.expected!=='' ? Math.max(0, Number(c.expected)) : planned;
      if(c && c.probCat){
        const cat = c.probCat; // 'High' | 'Medium' | 'Low'
        if(cat==='High' || cat==='Medium' || cat==='Low'){
          buckets[i][cat] += expected;
          buckets[i].Unassigned += Math.max(0, planned - expected);
        } else {
          buckets[i].Unassigned += planned;
        }
      }else{
        buckets[i].Unassigned += planned;
      }
    }
  }
  return buckets;
}

export default function App(){
  const [loadingRows,setLoadingRows]=useState([]);
  const [shopRows,setShopRows]=useState([]);
  const [projects,setProjects]=useState([]);
  const [startISO,setStartISO]=useState(()=>fmtISO(toMonday(new Date())));
  const [look,setLook]=useState(4);
  const [hideZero,setHideZero]=useState(false);
  const [view,setView]=useState('both');

  const [confs,setConfs]=useState(()=>({}));
  const keyShop=(p,w)=>`Shop|${p}|${w}`;
  const getConf=(p,w)=> confs[keyShop(p,w)] || { probCat:'', expected:'' };
  const setConf=(p,w,patch)=> setConfs(prev=>({ ...prev, [keyShop(p,w)]: { ...getConf(p,w), ...patch } }));

  const weekStarts=useMemo(()=>{ const base=new Date(startISO+'T00:00:00Z'); return Array.from({length:look},(_,i)=>fmtISO(new Date(base.getTime()+i*7*ONE_DAY))); },[startISO,look]);

  const projectList=useMemo(()=>{ const set=new Set(); loadingRows.forEach(r=>set.add(r.project)); shopRows.forEach(r=>set.add(r.project)); return Array.from(set).sort((a,b)=>a.localeCompare(b)); },[loadingRows,shopRows]);
  useEffect(()=>setProjects(projectList),[projectList]);

  const mapShop=useMemo(()=>{ const m=new Map(); shopRows.forEach(r=>{ const k=`${r.project}|${r.weekISO}`; m.set(k,(m.get(k)||0)+r.tons);}); return m; },[shopRows]);
  const mapLoad=useMemo(()=>{ const m=new Map(); loadingRows.forEach(r=>{ const k=`${r.project}|${r.weekISO}`; m.set(k,(m.get(k)||0)+r.tons);}); return m; },[loadingRows]);

  function summarize(which){
    const m = which==='Shop'? mapShop : mapLoad;
    const rows=[];
    for(const proj of projects){
      const arr = weekStarts.map(w=> m.get(`${proj}|${w}`)||0);
      const total = arr.reduce((a,b)=>a+b,0);
      rows.push({ project:proj, weeks:arr, total });
    }
    rows.sort((a,b)=>b.total-a.total);
    return rows;
  }
  const shopSummary=useMemo(()=>summarize('Shop'),[projects,weekStarts,mapShop]);
  const delSummary=useMemo(()=>summarize('Delivery'),[projects,weekStarts,mapLoad]);

  const kpis = useMemo(() => ({
  shop: shopSummary.reduce((s, r) => s + r.total, 0),
  del:  delSummary.reduce((s, r) => s + r.total, 0),
  projShop: shopSummary.filter(r => r.total > 0).length,
  projDel:  delSummary.filter(r => r.total > 0).length,
  }), [shopSummary, delSummary]);

  const backlog = kpis.shop - kpis.del;


  const buckets=useMemo(()=> computeShopBuckets(projects, weekStarts, mapShop, confs),[projects,weekStarts,confs,mapShop]);
  const probTotals = useMemo(() => {
    const totals = {
      High: { tons: 0, count: 0 },
      Medium: { tons: 0, count: 0 },
      Low: { tons: 0, count: 0 },
    };
    projects.forEach(proj => {
      weekStarts.forEach(w => {
        const key = `${proj}|${w}`;
        const c = confs[keyShop(proj, w)] || { probCat:'', expected:'' };
        if (!c.probCat) return;
        const cat = c.probCat;
        if (cat !== 'High' && cat !== 'Medium' && cat !== 'Low') return;
        const planned = mapShop.get(key) || 0;
        const expected = c.expected !== '' ? Math.max(0, Number(c.expected)) : planned;
        totals[cat].tons += expected;
        totals[cat].count += 1;
      });
    });
    return totals;
  }, [projects, weekStarts, confs, mapShop, keyShop]);
  const chartData=useMemo(()=> weekStarts.map((w,i)=>({
    week:`W${i+1} — ${w}`,
    ShopGrey:buckets[i]?.Unassigned||0, ShopHigh:buckets[i]?.High||0, ShopMed:buckets[i]?.Medium||0, ShopLow:buckets[i]?.Low||0,
    Delivery: delSummary.reduce((s,r)=>s+(r.weeks[i]||0),0)
  })),[weekStarts,buckets,delSummary]);

  function onUploadFile(file){
    const reader=new FileReader();
    reader.onload=(e)=>{
      const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const names=wb.SheetNames;
      const shopName = names.find(n=>/expected\s*issue|shop/i.test(n)) || names[1] || names[0];
      const loadName = names.find(n=>/load|deliver/i.test(n)) || names[0];
      const shopJson = XLSX.utils.sheet_to_json(wb.Sheets[shopName],{defval:null,raw:true});
      const loadJson = XLSX.utils.sheet_to_json(wb.Sheets[loadName],{defval:null,raw:true});
      const sNorm = normalizeSheet(shopJson); const lNorm = normalizeSheet(loadJson);
      setShopRows(sNorm.long); setLoadingRows(lNorm.long);
    };
    reader.readAsArrayBuffer(file);
  }

  function exportCSV(which){
    const data = which==='Shop'? shopSummary : delSummary;
    const header=['Project',...weekStarts,'Next_Total'];
    const lines=[header.join(',')];
    data.forEach(r=>{ if(hideZero && r.total===0) return; lines.push([r.project,...r.weeks.map(v=>v.toFixed(2)), r.total.toFixed(2)].join(',')); });
    const blob = new Blob([lines.join('\n')], {type:'text/plain'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`${which}_Lookahead_${startISO}_w${look}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  function LookaheadTable({ which }){
    const data= which==='Shop'? shopSummary : delSummary;
    return (<div style={{marginTop:12, padding:12, border:'1px solid #eee', borderRadius:16}}>
      <div style={{marginBottom:8}}><button onClick={()=>exportCSV(which)}>Export CSV</button></div>
      <div style={{overflow:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', tableLayout:'fixed'}}>
          <thead><tr>
            <th style={{textAlign:'left'}}>Project</th>
            {weekStarts.map((w,i)=>(<th key={w} style={{textAlign:'right'}}>W{i+1}<div style={{fontSize:12,color:'#6b7280'}}>{w}</div></th>))}
            <th style={{textAlign:'right'}}>Next {look} Total</th>
          </tr></thead>
          <tbody>
            {(hideZero ? data.filter(r => r.total > 0) : data).map(r=> (<React.Fragment key={r.project}>
              <tr>
                <td><strong>{r.project}</strong></td>
                {r.weeks.map((v,i)=>(<td key={i} style={{textAlign:'right'}}>{v? v.toFixed(2): ''}</td>))}
                <td style={{textAlign:'right'}}><strong>{r.total? r.total.toFixed(2): ''}</strong></td>
              </tr>
              {which==='Shop' && (
                <tr>
                  <td style={{color:'#6b7280'}}>↳ Prob / Expected</td>
                  {r.weeks.map((v,i)=>{ const w=weekStarts[i]; const planned=r.weeks[i]||0; const c=getConf(r.project,w);
                    return (
                      <td key={i} style={{verticalAlign:'top'}}>
                        <div style={{display:'flex', flexDirection:'column', gap:4}}>
                          <select value={c.probCat||''} onChange={(e)=> setConf(r.project,w,{ probCat: e.target.value })} style={{width:'100%'}}>
                            <option value="">—</option>
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                          </select>
                          <NumberField value={c.expected??''} placeholder={planned? planned.toFixed(2): ''} onCommit={(s)=> setConf(r.project,w,{ expected:s })} />
                        </div>
                      </td>
                    );
                  })}
                  <td></td>
                </tr>
              )}
            </React.Fragment>))}
          </tbody>
        </table>
      </div>
    </div>);
  }

  return (<div style={{padding:24,fontFamily:'ui-sans-serif,system-ui'}}>
    <h2>Shop & Delivery Dashboard</h2>
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,maxWidth:900}}>
      <label>Start <input type="date" value={startISO} onChange={e=>setStartISO(e.target.value)} /></label>
      <label>Lookahead <input type="number" min="1" max="26" value={look} onChange={e=>setLook(Math.max(1,Math.min(26, Number(e.target.value)||4)))} /></label>
      <label>View
        <select value={view} onChange={e=>setView(e.target.value)}><option value="both">Both</option><option value="shop">Shop</option><option value="delivery">Delivery</option></select>
      </label>
      <label>Hide zeros <input type="checkbox" checked={hideZero} onChange={e=>setHideZero(e.target.checked)} /></label>
    </div>
    <div style={{margin:'12px 0'}}>Load Excel: <input type="file" accept=".xlsx,.xls" onChange={e=> e.target.files && e.target.files[0] && onUploadFile(e.target.files[0])} /></div>
    {/* KPI cards */}
<div style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(1,1fr)',
  gap: 12,
  maxWidth: 1100,
  margin: '12px auto 0',
}}>
  <div style={{background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:14}}>
    <div style={{color:'#6b7280', fontSize:12}}>Shop Planned (next {look})</div>
    <div style={{fontWeight:700, fontSize:20}}>{kpis.shop.toFixed(2)}</div>
  </div>
  <div style={{background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:14}}>
    <div style={{color:'#6b7280', fontSize:12}}>Deliveries (next {look})</div>
    <div style={{fontWeight:700, fontSize:20}}>{kpis.del.toFixed(2)}</div>
  </div>
  <div style={{background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:14}}>
    <div style={{color:'#6b7280', fontSize:12}}>Backlog (Shop − Deliveries)</div>
    <div style={{fontWeight:700, fontSize:20, color: backlog >= 0 ? '#111827' : '#ef4444'}}>
      {backlog.toFixed(2)}
    </div>
  </div>
  <div style={{background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:14}}>
    <div style={{color:'#6b7280', fontSize:12}}>Projects in window</div>
    <div style={{fontWeight:700, fontSize:20}}>
      Shop: {kpis.projShop} &nbsp;•&nbsp; Delivery: {kpis.projDel}
    </div>
  </div>
  <div style={{background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:14}}>
    <div style={{color:'#6b7280', fontSize:12}}>High Probability (next {look})</div>
    <div style={{fontWeight:700, fontSize:20}}>{probTotals.High.count} cards — {probTotals.High.tons.toFixed(2)}</div>
  </div>
  <div style={{background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:14}}>
    <div style={{color:'#6b7280', fontSize:12}}>Medium Probability (next {look})</div>
    <div style={{fontWeight:700, fontSize:20}}>{probTotals.Medium.count} cards — {probTotals.Medium.tons.toFixed(2)}</div>
  </div>
  <div style={{background:'#fff', border:'1px solid #e5e7eb', borderRadius:16, padding:14}}>
    <div style={{color:'#6b7280', fontSize:12}}>Low Probability (next {look})</div>
    <div style={{fontWeight:700, fontSize:20}}>{probTotals.Low.count} cards — {probTotals.Low.tons.toFixed(2)}</div>
  </div>
</div>
<div style={{maxWidth: 1100, margin: '12px auto 0'}}>
  <div style={{height: 260, border:'1px solid #eee', borderRadius:16, padding:12}}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="week" /><YAxis /><Tooltip /><Legend />

        {/* Shop bars shown unless view=delivery */}
        {view !== 'delivery' && (
          <>
            <Bar stackId="shop" dataKey="ShopGrey"  name="Shop — Unassigned" fill="#9ca3af" />
            <Bar stackId="shop" dataKey="ShopHigh"  name="Shop — High"       fill="#16a34a" />
            <Bar stackId="shop" dataKey="ShopMed"   name="Shop — Medium"     fill="#f59e0b" />
            <Bar stackId="shop" dataKey="ShopLow"   name="Shop — Low"        fill="#ef4444" />
          </>
        )}

        {/* Delivery bar shown unless view=shop */}
        {view !== 'shop' && (
          <Bar dataKey="Delivery" name="Delivery (planned)" fill="#2563eb" />
        )}
      </BarChart>
    </ResponsiveContainer>
  </div>
</div>
    <h3>Shop Lookahead</h3>
    <LookaheadTable which="Shop" />
    <h3>Delivery Lookahead</h3>
    <LookaheadTable which="Delivery" />
  </div>);
}
