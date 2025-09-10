import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Line, LabelList } from "recharts";

// --- constants & utils ---
const ONE_DAY = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const COLORS = { shopHigh:'#16a34a', shopMed:'#f59e0b', shopLow:'#ef4444', shopGrey:'#9ca3af', delivery:'#2563eb' };

function excelSerialToDate(n){ const ms = EXCEL_EPOCH + Math.round(Number(n))*ONE_DAY; return new Date(ms); }
function toMonday(d){ const dd=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); const day=dd.getUTCDay(); const diff=(day+6)%7; dd.setUTCDate(dd.getUTCDate()-diff); return dd; }
function fmtISO(d){ return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }
function parseHeaderToDateKey(k){
  if(k==null) return null;
  if(typeof k==='number') return fmtISO(toMonday(excelSerialToDate(k)));
  if(k instanceof Date && !isNaN(k)) return fmtISO(toMonday(k));
  if(typeof k==='string'){
    const s = k.trim();
    // If header is a numeric string (e.g. "44952"), treat as Excel serial
    if(/^\d+(\.\d+)?$/.test(s)){
      return fmtISO(toMonday(excelSerialToDate(Number(s))));
    }
    const cleaned = s.replace(/\s+\d{2}:\d{2}:\d{2}$/,'');
    const d = new Date(cleaned);
    if(!isNaN(d)) return fmtISO(toMonday(d));
  }
  return null;
}
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
  const buckets = weekStarts.map(()=> ({ High:0, Medium:0, Low:0, Unassigned:0, Diff:0, Planned:0, Expected:0 }));
  const keyShop = (proj,w)=> `Shop|${proj}|${w}`;
  for(const proj of projects){
    for(let i=0;i<weekStarts.length;i++){
      const w=weekStarts[i];
      const planned = mapShop.get(`${proj}|${w}`) || 0;
      const c = confirmations[keyShop(proj,w)] || { probCat:'', expected:'' };
      let expected = planned;
      if(c && c.expected!=='' && !isNaN(Number(c.expected))){
        expected = Math.max(0, Number(c.expected));
      }
      buckets[i].Planned += planned;

      if(c && (c.probCat==='High' || c.probCat==='Medium' || c.probCat==='Low')){
        buckets[i][c.probCat] += expected;
        buckets[i].Expected += expected;
        if(planned > expected){
          buckets[i].Diff += planned - expected;
        }
      }else{
        buckets[i].Unassigned += expected; // expected equals planned when no probCat
        buckets[i].Expected += expected;
      }
    }
  }
  return buckets;
}


// ---------- XLSX helpers for cleaning RAW -> Dashboard ----------
function sheetToAOA(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const aoa = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      row.push(cell ? cell.v : undefined);
    }
    aoa.push(row);
  }
  return aoa;
}

function aoaToSheet(aoa) {
  // Trim right-side undefined to keep widths tight
  const trimmed = aoa.map(row => {
    let end = row.length;
    while (end > 0 && (row[end-1] === undefined || row[end-1] === null || row[end-1] === "")) end--;
    return row.slice(0, end);
  });
  return XLSX.utils.aoa_to_sheet(trimmed);
}

// Apply a simple date number format to first-row numeric headers
function formatHeaderDates(ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  for (let c = range.s.c + 1; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr];
    if (cell && typeof cell.v === 'number') {
      cell.z = 'm/d/yyyy';
    }
  }
}

function startsWithAny(s, prefixes) {
  if (s == null) return false;
  const v = String(s).trim();
  return prefixes.some(p => v.startsWith(p));
}

// Delete FIRST column whose header equals headerName (case insensitive)
function deleteColumnByHeader(aoa, headerName) {
  if (!aoa.length) return aoa;
  const hdrRow = aoa[0].map(v => (v == null ? "" : String(v)));
  const idx = hdrRow.findIndex(h => h.toLowerCase() === headerName.toLowerCase());
  if (idx === -1) return aoa;
  return aoa.map(row => row.filter((_, i) => i !== idx));
}

// Delete column at fixed index (0-based). No-op if out of range.
function deleteColumnIndex(aoa, idx) {
  if (idx == null || idx < 0) return aoa;
  return aoa.map(row => row.filter((_, i) => i !== idx));
}

// Filter out rows where first column starts with any of given prefixes (skip header)
function filterOutByColA(aoa, prefixes) {
  if (!aoa.length) return aoa;
  const [hdr, ...rest] = aoa;
  const kept = rest.filter(row => !startsWithAny(row[0], prefixes));
  return [hdr, ...kept];
}

// Make a Blob for download from a workbook
function makeXlsxBlob(wb) {
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/**
 * Transform a RAW workbook to the “Dashboard” shape in-memory.
 * Keeps two sheets and returns a NEW workbook:
 *   - Loading_Tons
 *   - Expected Issue to Shop
 */
function cleanRawToDashboard(wbRaw) {
  const keepExpected = "Expected Issue to Shop_1";
  const keepLoading  = "_1";
  if (!wbRaw.SheetNames.includes(keepExpected) || !wbRaw.SheetNames.includes(keepLoading)) {
    // Not a RAW workbook we recognize; return null to skip
    return null;
  }

  const prefixes = ["DF", "WW", "Grand", "99-997"];

  // --- Clean Loading_Tons (from "_1")
  const wsLoadRaw = wbRaw.Sheets[keepLoading];
  let aoaLoad = sheetToAOA(wsLoadRaw);
  // Filter Column A entries
  aoaLoad = filterOutByColA(aoaLoad, prefixes);
  // Delete the column named "Grand Total" (if present)
  aoaLoad = deleteColumnByHeader(aoaLoad, "Grand Total");
  const wsLoadClean = aoaToSheet(aoaLoad);
  formatHeaderDates(wsLoadClean);

  // --- Clean Expected Issue to Shop (from "Expected Issue to Shop_1")
  const wsShopRaw = wbRaw.Sheets[keepExpected];
  let aoaShop = sheetToAOA(wsShopRaw);
  // If Column B header is "Grand Total", delete it (column index 1)
  if (aoaShop.length && String(aoaShop[0][1] || "").toLowerCase() === "grand total".toLowerCase()) {
    aoaShop = deleteColumnIndex(aoaShop, 1);
  }
  // Filter Column A entries
  aoaShop = filterOutByColA(aoaShop, prefixes);
  const wsShopClean = aoaToSheet(aoaShop);
  formatHeaderDates(wsShopClean);

  // --- Build new workbook
  const wbNew = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbNew, wsLoadClean, "Loading_Tons");
  XLSX.utils.book_append_sheet(wbNew, wsShopClean, "Expected Issue to Shop");

  return wbNew;
}

export default function App(){
  const [loadingRows,setLoadingRows]=useState([]);
  const [shopRows,setShopRows]=useState([]);
  const [projects,setProjects]=useState([]);
  const [startISO,setStartISO]=useState(()=>fmtISO(toMonday(new Date())));
  const [look,setLook]=useState(4);
  const [hideZero,setHideZero]=useState(false);
  const [view,setView]=useState('both');
  const [cleanedBlob, setCleanedBlob] = useState(null);   // Blob of cleaned Dashboard.xlsx if we converted a RAW file

  const [confs,setConfs]=useState(()=>({}));
  const keyShop=(p,w)=>`Shop|${p}|${w}`;
  const getConf=(p,w)=> confs[keyShop(p,w)] || { probCat:'', expected:'' };
  const setConf=(p,w,patch)=> setConfs(prev=>({ ...prev, [keyShop(p,w)]: { ...getConf(p,w), ...patch } }));

  const [activeCats,setActiveCats]=useState(()=> new Set(['High','Medium','Low']));
  const [showMA,setShowMA]=useState(false);

  const weekStarts=useMemo(()=>{ const base=new Date(startISO+'T00:00:00Z'); return Array.from({length:look},(_,i)=>fmtISO(new Date(base.getTime()+i*7*ONE_DAY))); },[startISO,look]);

  function toggleCat(cat){
    setActiveCats(prev=>{
      const next = new Set(prev);
      if(next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function handleLegendClick(o){
    const map = { ShopHigh:'High', ShopMed:'Medium', ShopLow:'Low' };
    const cat = map[o.dataKey];
    if(cat) toggleCat(cat);
  }

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

  const kpiCards = [
    { key: 'shop',    label: `Shop Planned (next ${look})`, value: kpis.shop.toFixed(2) },
    { key: 'del',     label: `Deliveries (next ${look})`,    value: kpis.del.toFixed(2) },
    {
      key: 'backlog',
      label: 'Backlog (Shop − Deliveries)',
      value: backlog.toFixed(2),
      valueColor: backlog >= 0 ? '#111827' : '#ef4444'
    },
    {
      key: 'proj',
      label: 'Projects in window',
      value: `Shop: ${kpis.projShop} • Delivery: ${kpis.projDel}`
    },
    {
      key: 'high',
      label: `High Probability (next ${look})`,
      value: `${probTotals.High.count} cards — ${probTotals.High.tons.toFixed(2)}`
    },
    {
      key: 'medium',
      label: `Medium Probability (next ${look})`,
      value: `${probTotals.Medium.count} cards — ${probTotals.Medium.tons.toFixed(2)}`
    },
    {
      key: 'low',
      label: `Low Probability (next ${look})`,
      value: `${probTotals.Low.count} cards — ${probTotals.Low.tons.toFixed(2)}`
    }
  ];
  const chartData=useMemo(()=>{
    const arr = weekStarts.map((w,i)=>{
      const planned = buckets[i]?.Planned || 0;
      const unass = buckets[i]?.Unassigned || 0;
      const high = activeCats.has('High') ? (buckets[i]?.High || 0) : 0;
      const med  = activeCats.has('Medium') ? (buckets[i]?.Medium || 0) : 0;
      const low  = activeCats.has('Low') ? (buckets[i]?.Low || 0) : 0;
      const expected = high + med + low + unass;
      const diff = Math.max(0, planned - expected);
      const delivery = delSummary.reduce((s,r)=>s+(r.weeks[i]||0),0);
      return {
        week:`W${i+1} — ${w}`,
        ShopUnassigned: unass,
        ShopHigh: high,
        ShopMed: med,
        ShopLow: low,
        ShopDiff: diff,
        Planned: planned,
        ExpectedTotal: expected,
        Delivery: delivery,
      };
    });
    for(let i=0;i<arr.length;i++){
      arr[i].ExpectedDelta = i>0 ? arr[i].ExpectedTotal - arr[i-1].ExpectedTotal : 0;
      arr[i].DeliveryDelta = i>0 ? arr[i].Delivery - arr[i-1].Delivery : 0;
      const win = arr.slice(Math.max(0,i-2), i+1);
      arr[i].DeliveryMA = win.reduce((s,r)=>s+r.Delivery,0)/win.length;
    }
    return arr;
  },[weekStarts,buckets,delSummary,activeCats]);

  function CustomTooltip({ active, payload, label }){
    if(!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    return (
      <div style={{ background:'#fff', border:'1px solid #d1d5db', padding:8 }}>
        <div><strong>{label}</strong></div>
        <div>Planned: {p.Planned?.toFixed(2)}</div>
        <div>Expected: {p.ExpectedTotal?.toFixed(2)} (Δ {p.ExpectedDelta?.toFixed(2)})</div>
        <div>Delivery: {p.Delivery?.toFixed(2)} (Δ {p.DeliveryDelta?.toFixed(2)})</div>
      </div>
    );
  }

  function onUploadFile(f) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      let wb = XLSX.read(data, { type: "array" });

      // If it looks like RAW (Expected Issue to Shop_1 + _1), clean it first
      const maybeClean = cleanRawToDashboard(wb);
      if (maybeClean) {
        wb = maybeClean; // use cleaned
        setCleanedBlob(makeXlsxBlob(wb)); // enable "Download cleaned" button
      } else {
        setCleanedBlob(null); // already clean; no blob
      }

      // Names after cleaning (or if already clean)
      const names = wb.SheetNames;
      const shopName = names.find((n) => /expected\s*issue\s*to\s*shop$/i.test(n)) || names[1] || names[0];
      const loadName = names.find((n) => /^loading\s*_?tons$/i.test(n)) || names[0];

      const shopJson = XLSX.utils.sheet_to_json(wb.Sheets[shopName], { defval: null, raw: true });
      const loadJson = XLSX.utils.sheet_to_json(wb.Sheets[loadName], { defval: null, raw: true });

      const shopNorm = normalizeSheet(shopJson);
      const loadNorm = normalizeSheet(loadJson);

      setShopRows(shopNorm.long);
      setLoadingRows(loadNorm.long);
    };
    reader.readAsArrayBuffer(f);
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
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12}}>
      <label>Start <input type="date" value={startISO} onChange={e=>setStartISO(e.target.value)} /></label>
      <label>Lookahead <input type="number" min="1" max="26" value={look} onChange={e=>setLook(Math.max(1,Math.min(26, Number(e.target.value)||4)))} /></label>
      <label>View
        <select value={view} onChange={e=>setView(e.target.value)}><option value="both">Both</option><option value="shop">Shop</option><option value="delivery">Delivery</option></select>
      </label>
      <label>Hide zeros <input type="checkbox" checked={hideZero} onChange={e=>setHideZero(e.target.checked)} /></label>
      <label>Moving avg <input type="checkbox" checked={showMA} onChange={e=>setShowMA(e.target.checked)} /></label>
    </div>
    <div style={{margin:'12px 0'}}>Load Excel: <input type="file" accept=".xlsx,.xls" onChange={e=> e.target.files && e.target.files[0] && onUploadFile(e.target.files[0])} />
    {cleanedBlob && (
      <button
        style={{marginLeft:8, padding:'6px 10px', borderRadius:8}}
        onClick={() => {
          const url = URL.createObjectURL(cleanedBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "Dashboard.xlsx";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 500);
        }}
      >
        Download cleaned Dashboard.xlsx
      </button>
    )}
  </div>
    {/* KPI cards */}
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
        gap: 12,
        margin: '12px 0 0',
      }}
    >
      {kpiCards.map(card => {
        const catName = card.key.charAt(0).toUpperCase() + card.key.slice(1);
        const clickable = ['high','medium','low'].includes(card.key);
        const active = clickable ? activeCats.has(catName) : true;
        return (
          <div
            key={card.key}
            onClick={() => clickable && toggleCat(catName)}
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              aspectRatio: '2',
              textAlign: 'center',
              cursor: clickable ? 'pointer' : 'default',
              opacity: active ? 1 : 0.3,
            }}
          >
            <div style={{ color: '#6b7280', fontSize: 12 }}>{card.label}</div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 20,
                color: card.valueColor || '#111827',
              }}
            >
              {card.value}
            </div>
          </div>
        );
      })}
    </div>
<div style={{margin: '12px 0 0'}}>
  <div style={{height: 260, border:'1px solid #eee', borderRadius:16, padding:12}}>
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData}>
        <defs>
          <pattern id="gapHatch" patternUnits="userSpaceOnUse" width="4" height="4">
            <path d="M0 0L4 4M4 0L0 4" stroke="#9ca3af" strokeWidth="1" />
          </pattern>
        </defs>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="week" />
        <YAxis />
        <Tooltip content={<CustomTooltip />} />
        <Legend onClick={handleLegendClick} />

        {view !== 'delivery' && (
          <>
            <Bar stackId="shop" dataKey="ShopUnassigned" name="Shop — Unassigned" fill="#9ca3af" />
            <Bar stackId="shop" dataKey="ShopHigh" name="Shop — High" fill="#16a34a" />
            <Bar stackId="shop" dataKey="ShopMed" name="Shop — Medium" fill="#f59e0b" />
            <Bar stackId="shop" dataKey="ShopLow" name="Shop — Low" fill="#ef4444" />
            <Bar stackId="shop" dataKey="ShopDiff" name="Planned gap" fill="url(#gapHatch)" legendType="none">
              <LabelList content={({x,y,width,height,payload})=>{
                const expected = payload.ExpectedTotal;
                const yy = y + height - 4;
                return <text x={x+width/2} y={yy} textAnchor="middle" fontSize={10}>{expected? expected.toFixed(0):''}</text>;
              }} />
            </Bar>
          </>
        )}

        {view !== 'shop' && (
          <Bar dataKey="Delivery" name="Delivery (planned)" fill="#2563eb" />
        )}

        <Line type="monotone" dataKey="Planned" stroke="#111827" strokeWidth={2} dot={false} label={({x,y,value})=> (
          <text x={x} y={y-4} textAnchor="middle" fontSize={10}>{value? value.toFixed(0):''}</text>
        )} />

        {showMA && view !== 'shop' && (
          <Line type="monotone" dataKey="DeliveryMA" name="Delivery 3w MA" stroke="#2563eb" strokeDasharray="5 5" dot={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  </div>
</div>
    <h3>Shop Lookahead</h3>
    <LookaheadTable which="Shop" />
    <h3>Delivery Lookahead</h3>
    <LookaheadTable which="Delivery" />
  </div>);
}
