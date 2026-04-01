import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

/*
 * ═══════════════════════════════════════════════════════════════
 *  HEALTH SCORE — CSM Dashboard
 *  Connects to n8n webhook (set WEBHOOK_URL below).
 *  Each Success Manager sees their book of business with:
 *    - MRR
 *    - Index score  (Loyalty 60% + Feedback 40%)
 *    - Momentum     (actividad, variación, proyección, penalidades)
 *    - Freshness    (data recency badge)
 *  All 3 HS components are sortable. Hover reveals score breakdown.
 * ═══════════════════════════════════════════════════════════════
 */

const WEBHOOK_URL = "https://n8n.vambe.me/webhook/health-score";

// ── Mock data ────────────────────────────────────────────────────
function mockData() {
  const clients = [
    "Clínica Santa María","NotCo","Betterfly","Buk","Fintual","Cencosud","Rappi Chile",
    "Platanus","Houm","Xepelin","Bsale","Chiper","Destacame","Global66","Lemontech",
    "Nubox","Shinkansen","Toku","Racional","Beetrack","SimpliRoute","AgendaPro",
    "Legalpilot","DataScope","Videsk","Welcu","Chipax","Floid","Cornershop","Falabella"
  ];
  const csms = ["Max Donoso","Catalina Reyes","Felipe Muñoz","Javiera Soto","Nicolás Parra"];
  const plans = ["Starter","Growth","Professional","Enterprise","Enterprise Plus"];
  const countries = ["Chile","México","Colombia","Perú","Argentina"];
  const pick = a => a[Math.floor(Math.random()*a.length)];
  const rnd = (min,max) => Math.round((Math.random()*(max-min)+min)*10)/10;
  const maybe = (prob, fn) => Math.random() < prob ? fn() : null;

  return clients.map((name, i) => {
    const loyaltyValue = maybe(0.85, () => Math.floor(Math.random()*5)+1);
    const feedbackValue = maybe(0.7, () => rnd(1,10));
    let indexScore = null;
    if (loyaltyValue !== null && feedbackValue !== null) {
      indexScore = Math.round(((loyaltyValue*2)*0.6 + feedbackValue*0.4)*10)/10;
    } else if (loyaltyValue !== null) {
      indexScore = Math.round(loyaltyValue*2*10)/10;
    } else if (feedbackValue !== null) {
      indexScore = Math.round(feedbackValue*10)/10;
    }

    const momRaw = maybe(0.85, () => Math.round(Math.random()*1000)/1000);
    const momScore = momRaw !== null ? (momRaw>=.8?5:momRaw>=.6?4:momRaw>=.4?3:momRaw>=.2?2:1) : null;
    const momSymbols = {5:"↑↑",4:"↑",3:"→",2:"↓",1:"↓↓"};
    const momLabels = {5:"Acelerando fuerte",4:"Creciendo",3:"Estable",2:"Decayendo",1:"Caída crítica"};
    const freshOpts = ["verde","amarillo","rojo","sin_fecha"];
    const freshness = indexScore !== null ? pick(freshOpts) : null;

    const daysActive30 = maybe(0.8, () => Math.floor(Math.random()*28));
    const variacionPct = maybe(0.75, () => rnd(-60,80));
    const proyeccion = maybe(0.8, () => rnd(0,1.5));
    const pagoRechazado = Math.random() < 0.1 ? 1 : 0;
    const daysSinceLast = maybe(0.85, () => Math.floor(Math.random()*45));

    const loyaltyReason = loyaltyValue !== null
      ? pick(["Antigüedad > 12 meses","Upgrade reciente","NRR positivo","Contrato renovado","Cliente referido"])
      : null;
    const feedbackSource = feedbackValue !== null
      ? pick(["NPS reciente","CSAT Onboarding","NPS Q4","CSAT Soporte"])
      : null;

    const mrr = [29990,49990,79990,99990,149990,249990,399990,499990][Math.floor(Math.random()*8)];

    return {
      client_id: `cl_${String(i+1).padStart(3,"0")}`,
      client_name: name,
      email: `${name.toLowerCase().replace(/\s+/g,".")}@empresa.cl`,
      plan: pick(plans),
      mrr,
      country: pick(countries),
      csm: pick(csms),
      index_score: indexScore,
      loyalty_value: loyaltyValue,
      loyalty_reason: loyaltyReason,
      feedback_value: feedbackValue,
      feedback_source: feedbackSource,
      freshness,
      momentum_score: momScore,
      momentum_symbol: momScore ? momSymbols[momScore] : null,
      momentum_label: momScore ? momLabels[momScore] : null,
      momentum_raw: momRaw,
      days_active_30: daysActive30,
      variacion_pct: variacionPct,
      proyeccion_sobre_limite: proyeccion,
      pago_rechazado: pagoRechazado,
      days_since_last_use: daysSinceLast,
    };
  });
}

// ── Formatting ───────────────────────────────────────────────────
const fmtCLP = n => n != null ? `$${n.toLocaleString("es-CL")}` : "—";
// eslint-disable-next-line no-unused-vars
const fmtPct = n => n != null ? `${n > 0 ? "+" : ""}${n}%` : "—";

// ── Freshness config ─────────────────────────────────────────────
const FRESH = {
  verde:     { bg:"#dcfce7", fg:"#15803d", dot:"#16a34a", label:"Fresco",    desc:"Datos actualizados hace < 30 días" },
  amarillo:  { bg:"#fef9c3", fg:"#a16207", dot:"#ca8a04", label:"Tibio",     desc:"Última actualización: 30-60 días" },
  rojo:      { bg:"#fee2e2", fg:"#b91c1c", dot:"#dc2626", label:"Stale",     desc:"Datos con > 60 días de antigüedad" },
  sin_fecha: { bg:"#f3f4f6", fg:"#6b7280", dot:"#9ca3af", label:"Sin fecha", desc:"No hay fecha de referencia" },
};

const MOM_C = {
  5:{bg:"#dcfce7",fg:"#15803d",accent:"#16a34a"},
  4:{bg:"#f0fdf4",fg:"#166534",accent:"#22c55e"},
  3:{bg:"#f3f4f6",fg:"#374151",accent:"#6b7280"},
  2:{bg:"#fff7ed",fg:"#9a3412",accent:"#f97316"},
  1:{bg:"#fee2e2",fg:"#991b1b",accent:"#ef4444"},
};

// ── Tooltip component ────────────────────────────────────────────
function Tooltip({ children, content, width = 280 }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef(null);
  const tipRef = useRef(null);

  const handleEnter = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top - 8;
    // Clamp to viewport
    if (x - width/2 < 8) x = width/2 + 8;
    if (x + width/2 > window.innerWidth - 8) x = window.innerWidth - width/2 - 8;
    setPos({ x, y });
    setShow(true);
  }, [width]);

  return (
    <span
      ref={ref}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
      style={{ position: "relative", cursor: "default" }}
    >
      {children}
      {show && createPortal(
        <div ref={tipRef} style={{
          position:"fixed", left:pos.x, top:pos.y, transform:"translate(-50%, -100%)",
          width, background:"#1a1a28", border:"1px solid #2d2d44", borderRadius:10,
          padding:"14px 16px", zIndex:9999, boxShadow:"0 12px 40px rgba(0,0,0,0.6)",
          pointerEvents:"none", opacity:1,
        }}>
          {content}
          <div style={{
            position:"absolute", bottom:-6, left:"50%", transform:"translateX(-50%) rotate(45deg)",
            width:12, height:12, background:"#1a1a28", borderRight:"1px solid #2d2d44",
            borderBottom:"1px solid #2d2d44",
          }}/>
        </div>,
        document.body
      )}
    </span>
  );
}

// ── Index tooltip content ────────────────────────────────────────
function IndexTooltip({ c }) {
  const hasLoy = c.loyalty_value != null;
  const hasFb = c.feedback_value != null;
  return (
    <div style={{ fontFamily:"'Söhne', 'DM Sans', sans-serif", fontSize:12, color:"#d1d5db" }}>
      <div style={{ fontWeight:700, color:"#e8d5b7", fontSize:13, marginBottom:8, letterSpacing:0.3 }}>
        INDEX — {c.index_score != null ? c.index_score+"/10" : "Sin datos"}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#9ca3af" }}>Loyalty <span style={{color:"#6b7280",fontSize:10}}>(60%)</span></span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:600, color: hasLoy ? "#e8d5b7" : "#4b5563" }}>
            {hasLoy ? `L${c.loyalty_value} → ${c.loyalty_value*2}pts` : "—"}
          </span>
        </div>
        {hasLoy && c.loyalty_reason && (
          <div style={{ fontSize:10, color:"#7c7c8a", marginTop:-4, paddingLeft:4 }}>
            ↳ {c.loyalty_reason}
          </div>
        )}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#9ca3af" }}>Feedback <span style={{color:"#6b7280",fontSize:10}}>(40%)</span></span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:600, color: hasFb ? "#e8d5b7" : "#4b5563" }}>
            {hasFb ? `${c.feedback_value}pts` : "—"}
          </span>
        </div>
        {hasFb && c.feedback_source && (
          <div style={{ fontSize:10, color:"#7c7c8a", marginTop:-4, paddingLeft:4 }}>
            ↳ Fuente: {c.feedback_source}
          </div>
        )}
      </div>
      <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid #2d2d44", fontSize:10, color:"#6b7280", fontFamily:"'JetBrains Mono',monospace" }}>
        Fórmula: Loyalty×2 × 0.6 + Feedback × 0.4
      </div>
    </div>
  );
}

// ── Momentum tooltip content ─────────────────────────────────────
function MomentumTooltip({ c }) {
  const hasMom = c.momentum_score != null;
  const bar = (label, val, max, color) => {
    const pct = val != null ? Math.min(Math.abs(val)/max*100, 100) : 0;
    return (
      <div style={{ marginBottom: 6 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:2 }}>
          <span style={{ color:"#9ca3af" }}>{label}</span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", color: val != null ? "#e8d5b7" : "#4b5563", fontWeight:500 }}>
            {val != null ? (typeof val === "number" ? (Number.isInteger(val) ? val : val.toFixed(1)) : val) : "—"}
          </span>
        </div>
        <div style={{ height:3, background:"#1a1a1a", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:2 }}/>
        </div>
      </div>
    );
  };
  return (
    <div style={{ fontFamily:"'Söhne', 'DM Sans', sans-serif", fontSize:12, color:"#d1d5db" }}>
      <div style={{ fontWeight:700, color:"#e8d5b7", fontSize:13, marginBottom:8, letterSpacing:0.3 }}>
        MOMENTUM — {hasMom ? `${c.momentum_symbol} ${c.momentum_label}` : "Sin datos"}
      </div>
      {hasMom && (
        <div style={{ marginBottom:6, fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#7c7c8a" }}>
          Raw: {c.momentum_raw} → Score: {c.momentum_score}/5
        </div>
      )}
      <div style={{ fontSize:10, color:"#6b7280", marginBottom:6, textTransform:"uppercase", letterSpacing:0.5 }}>Señales de producto</div>
      {bar("Días activos /30d", c.days_active_30, 28, "#60a5fa")}
      {bar("Variación convos %", c.variacion_pct, 80, c.variacion_pct >= 0 ? "#4ade80" : "#f97316")}
      {bar("Uso/Límite plan", c.proyeccion_sobre_limite, 1.2, "#a78bfa")}
      <div style={{ marginTop:6, fontSize:10, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Penalidades</div>
      <div style={{ display:"flex", gap:12, fontSize:11 }}>
        <span style={{ color: c.pago_rechazado ? "#ef4444" : "#4b5563" }}>
          {c.pago_rechazado ? "⚠ Pago rechazado (−65%)" : "✓ Pago OK"}
        </span>
        <span style={{ color: c.days_since_last_use != null && c.days_since_last_use > 14 ? "#f97316" : "#4b5563" }}>
          {c.days_since_last_use != null ? `${c.days_since_last_use}d sin usar` : "Sin dato"}
        </span>
      </div>
      <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid #2d2d44", fontSize:10, color:"#6b7280", fontFamily:"'JetBrains Mono',monospace" }}>
        base = DA×0.53 + VA×0.27 + PR×0.20 → × penalties
      </div>
    </div>
  );
}

// ── Freshness tooltip content ────────────────────────────────────
function FreshnessTooltip({ c }) {
  const f = c.freshness ? FRESH[c.freshness] : null;
  return (
    <div style={{ fontFamily:"'Söhne', 'DM Sans', sans-serif", fontSize:12, color:"#d1d5db" }}>
      <div style={{ fontWeight:700, color:"#e8d5b7", fontSize:13, marginBottom:8, letterSpacing:0.3 }}>
        FRESHNESS — {f ? f.label : "Sin datos"}
      </div>
      <p style={{ margin:"0 0 8px", fontSize:12, color:"#9ca3af", lineHeight:1.5 }}>
        {f ? f.desc : "No hay datos de Index para evaluar frescura."}
      </p>
      <div style={{ fontSize:10, color:"#6b7280", lineHeight:1.5 }}>
        La frescura indica qué tan recientes son los datos de Loyalty y Feedback que componen el Index. Se mide desde la fecha más reciente entre ambos inputs.
      </div>
      <div style={{ marginTop:8, display:"flex", gap:8 }}>
        {Object.entries(FRESH).filter(([k])=>k!=="sin_fecha").map(([key, v]) => (
          <span key={key} style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"2px 6px", borderRadius:99, background: c.freshness===key ? v.bg : "transparent", border: c.freshness===key ? `1px solid ${v.dot}33` : "1px solid transparent", fontSize:10, color: v.fg, opacity: c.freshness===key ? 1 : 0.4 }}>
            <span style={{ width:5, height:5, borderRadius:"50%", background:v.dot }}/>
            {v.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Index mini gauge ─────────────────────────────────────────────
function IndexDot({ value }) {
  if (value == null) return <span style={{ color:"#d1d5db", fontSize:13 }}>—</span>;
  const color = value >= 8 ? "#34d399" : value >= 6 ? "#60a5fa" : value >= 4 ? "#fbbf24" : "#ef4444";
  const pct = Math.min(value/10, 1);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:80 }}>
      <div style={{ width:36, height:36, position:"relative" }}>
        <svg width={36} height={36} viewBox="0 0 36 36" style={{ transform:"rotate(-90deg)" }}>
          <circle cx={18} cy={18} r={14} fill="none" stroke="#e5e7eb" strokeWidth={3}/>
          <circle cx={18} cy={18} r={14} fill="none" stroke={color} strokeWidth={3}
            strokeDasharray={`${87.96*pct} ${87.96*(1-pct)}`}
            strokeLinecap="round"
            style={{ transition:"stroke-dasharray 0.6s ease" }}/>
        </svg>
        <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color, fontFamily:"'JetBrains Mono',monospace" }}>
          {value}
        </span>
      </div>
    </div>
  );
}

// ── Momentum badge ───────────────────────────────────────────────
function MomentumBadge({ score, symbol, label }) {
  if (score == null) return <span style={{ color:"#d1d5db", fontSize:13 }}>—</span>;
  const mc = MOM_C[score];
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:6, background:mc.bg }}>
      <span style={{ fontSize:16, color:mc.accent, lineHeight:1 }}>{symbol}</span>
      <span style={{ fontSize:11, color:mc.fg, fontWeight:500 }}>{label}</span>
    </div>
  );
}

// ── Freshness badge ──────────────────────────────────────────────
function FreshBadge({ freshness }) {
  if (!freshness) return <span style={{ color:"#d1d5db", fontSize:13 }}>—</span>;
  const f = FRESH[freshness];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 9px", borderRadius:99, background:f.bg, color:f.fg, fontSize:11, fontWeight:500 }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:f.dot }}/>
      {f.label}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════
//  MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════
export default function HealthDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCSM, setSelectedCSM] = useState(null);
  const [sortKey, setSortKey] = useState("mrr");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        if (!WEBHOOK_URL) {
          await new Promise(r => setTimeout(r, 500));
          setData(mockData());
        } else {
          const res = await fetch(WEBHOOK_URL);
          const json = await res.json();
          // n8n returns {summary, clients} — we use the clients array
          setData(json.clients || json);
        }
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const csms = useMemo(() => {
    const map = {};
    data.forEach(c => {
      const name = c.csm || "Sin asignar";
      if (!map[name]) map[name] = { count: 0, mrr: 0 };
      map[name].count++;
      map[name].mrr += c.mrr || 0;
    });
    return Object.entries(map).sort((a,b) => b[1].mrr - a[1].mrr).map(([name, info]) => ({ name, ...info }));
  }, [data]);

  // Auto-select first CSM
  useEffect(() => {
    if (csms.length > 0 && selectedCSM === null) setSelectedCSM(csms[0].name);
  }, [csms, selectedCSM]);

  const handleSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) { setSortDir(d => d === "desc" ? "asc" : "desc"); return key; }
      setSortDir("desc");
      return key;
    });
  }, []);

  const clients = useMemo(() => {
    let list = data.filter(c => (c.csm || "Sin asignar") === selectedCSM);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => (c.client_name||"").toLowerCase().includes(q) || (c.email||"").toLowerCase().includes(q));
    }
    const dir = sortDir === "desc" ? -1 : 1;
    list.sort((a, b) => {
      let va, vb;
      switch (sortKey) {
        case "mrr": va = a.mrr||0; vb = b.mrr||0; break;
        case "index": va = a.index_score ?? -999; vb = b.index_score ?? -999; break;
        case "momentum": va = a.momentum_score ?? -999; vb = b.momentum_score ?? -999; break;
        case "freshness": {
          const order = { verde:4, amarillo:3, rojo:2, sin_fecha:1 };
          va = order[a.freshness] || 0; vb = order[b.freshness] || 0; break;
        }
        case "name": return dir * (a.client_name||"").localeCompare(b.client_name||"");
        default: va = 0; vb = 0;
      }
      return dir * (va - vb);
    });
    return list;
  }, [data, selectedCSM, search, sortKey, sortDir]);

  const csmStats = useMemo(() => {
    const list = data.filter(c => (c.csm||"Sin asignar") === selectedCSM);
    const withIdx = list.filter(c => c.index_score != null);
    const withMom = list.filter(c => c.momentum_score != null);
    return {
      count: list.length,
      mrr: list.reduce((s,c) => s+(c.mrr||0), 0),
      avgIndex: withIdx.length ? Math.round(withIdx.reduce((s,c) => s+c.index_score, 0)/withIdx.length*10)/10 : null,
      avgMom: withMom.length ? Math.round(withMom.reduce((s,c) => s+c.momentum_score, 0)/withMom.length*10)/10 : null,
      critical: list.filter(c => (c.index_score != null && c.index_score <= 4) || (c.momentum_score != null && c.momentum_score <= 1)).length,
    };
  }, [data, selectedCSM]);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#f9fafb", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
      <div style={{ width:40, height:40, borderRadius:"50%", border:"3px solid #e5e7eb", borderTopColor:"#c9a96e", animation:"spin 0.8s linear infinite" }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ minHeight:"100vh", background:"#f9fafb", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <p style={{ color:"#ef4444" }}>Error: {error}</p>
    </div>
  );

  const SortHeader = ({ label, sortId, align = "center" }) => {
    const active = sortKey === sortId;
    return (
      <th onClick={() => handleSort(sortId)} style={{ ...S.th, textAlign:align, cursor:"pointer", userSelect:"none", color: active ? "#c9a96e" : "#6b7280", transition:"color 0.2s" }}>
        {label}
        <span style={{ marginLeft:4, fontSize:9, opacity: active ? 1 : 0 }}>
          {sortDir === "desc" ? "▼" : "▲"}
        </span>
      </th>
    );
  };

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        *::-webkit-scrollbar{width:6px;height:6px}
        *::-webkit-scrollbar-track{background:#f3f4f6}
        *::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px}
        *::-webkit-scrollbar-thumb:hover{background:#9ca3af}
      `}</style>

      {/* ── Left sidebar: CSM list ─────────────────────────────── */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <span style={{ color:"#c9a96e", fontSize:18 }}>⬡</span>
          <span style={{ fontWeight:700, fontSize:15, color:"#111827", letterSpacing:-0.3 }}>Health Score</span>
        </div>
        <div style={{ padding:"0 12px 12px", fontSize:10, color:"#9ca3af", fontFamily:"'JetBrains Mono',monospace", textTransform:"uppercase", letterSpacing:0.5 }}>
          Success Managers
        </div>
        <nav style={{ flex:1, overflowY:"auto", padding:"0 8px" }}>
          {csms.map((csm, i) => {
            const active = csm.name === selectedCSM;
            return (
              <button key={csm.name} onClick={() => setSelectedCSM(csm.name)} style={{
                ...S.csmBtn,
                background: active ? "#eff6ff" : "transparent",
                borderLeft: active ? "2px solid #c9a96e" : "2px solid transparent",
                animation: `slideIn 0.3s ease ${i*0.04}s both`,
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontWeight: active ? 600 : 400, color: active ? "#111827" : "#6b7280", fontSize:13 }}>
                    {csm.name}
                  </span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b7280" }}>
                    {csm.count}
                  </span>
                </div>
                <div style={{ fontSize:11, color:"#9ca3af", fontFamily:"'JetBrains Mono',monospace", marginTop:2 }}>
                  {fmtCLP(csm.mrr)}
                </div>
              </button>
            );
          })}
        </nav>
        <div style={S.sidebarFooter}>
          <div style={{ fontSize:10, color:"#9ca3af" }}>
            {!WEBHOOK_URL ? "MOCK DATA" : "LIVE"} · {data.length} cuentas
          </div>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────── */}
      <main style={S.main}>
        {/* CSM header */}
        <header style={S.header}>
          <div>
            <h1 style={S.title}>{selectedCSM}</h1>
            <p style={S.subtitle}>{csmStats.count} cuentas · {fmtCLP(csmStats.mrr)} MRR</p>
          </div>
          <div style={{ display:"flex", gap:16 }}>
            {[
              { label:"Avg Index", value: csmStats.avgIndex != null ? csmStats.avgIndex+"/10" : "—", color:"#c9a96e" },
              { label:"Avg Momentum", value: csmStats.avgMom != null ? csmStats.avgMom+"/5" : "—", color:"#60a5fa" },
              { label:"Críticos", value: csmStats.critical, color: csmStats.critical > 0 ? "#ef4444" : "#34d399" },
            ].map(kpi => (
              <div key={kpi.label} style={S.kpi}>
                <div style={{ fontSize:10, color:"#6b7280", fontFamily:"'JetBrains Mono',monospace", textTransform:"uppercase", letterSpacing:0.5 }}>{kpi.label}</div>
                <div style={{ fontSize:22, fontWeight:700, color:kpi.color, fontFamily:"'JetBrains Mono',monospace" }}>{kpi.value}</div>
              </div>
            ))}
          </div>
        </header>

        {/* Search */}
        <div style={{ marginBottom:16 }}>
          <input type="text" placeholder="Buscar cliente…" value={search} onChange={e => setSearch(e.target.value)} style={S.search}/>
        </div>

        {/* Table */}
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <SortHeader label="Cliente" sortId="name" align="left"/>
                <SortHeader label="MRR" sortId="mrr" align="right"/>
                <SortHeader label="Index" sortId="index"/>
                <SortHeader label="Momentum" sortId="momentum"/>
                <SortHeader label="Freshness" sortId="freshness"/>
              </tr>
            </thead>
            <tbody>
              {clients.map((c, i) => (
                <tr key={c.client_id} style={{ ...S.tr, animation:`fadeIn 0.3s ease ${i*0.03}s both` }}
                    onMouseOver={e => { e.currentTarget.style.background="#f0f4f8"; }}
                    onMouseOut={e => { e.currentTarget.style.background="transparent"; }}>
                  <td style={{ ...S.td, maxWidth:220 }}>
                    <a href={c.backofficeUrl} target="_blank" rel="noopener noreferrer"
                       style={{ fontWeight:600, color:"#111827", fontSize:13, textDecoration:"none", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", display:"block" }}
                       onMouseOver={e => e.target.style.color="#c9a96e"}
                       onMouseOut={e => e.target.style.color="#111827"}>
                      {c.client_name}
                    </a>
                    <div style={{ fontSize:10, color:"#6b7280", marginTop:1 }}>{c.plan} · {c.country}</div>
                  </td>
                  <td style={{ ...S.td, textAlign:"right", fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:500, color:"#111827" }}>
                    {fmtCLP(c.mrr)}
                  </td>
                  <td style={{ ...S.td, textAlign:"center" }}>
                    <Tooltip content={<IndexTooltip c={c}/>} width={260}>
                      <IndexDot value={c.index_score}/>
                    </Tooltip>
                  </td>
                  <td style={{ ...S.td, textAlign:"center" }}>
                    <Tooltip content={<MomentumTooltip c={c}/>} width={300}>
                      <MomentumBadge score={c.momentum_score} symbol={c.momentum_symbol} label={c.momentum_label}/>
                    </Tooltip>
                  </td>
                  <td style={{ ...S.td, textAlign:"center" }}>
                    <Tooltip content={<FreshnessTooltip c={c}/>} width={280}>
                      <FreshBadge freshness={c.freshness}/>
                    </Tooltip>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr><td colSpan={5} style={{ ...S.td, textAlign:"center", color:"#9ca3af", padding:40 }}>
                  {search ? "Sin resultados" : "Sin clientes asignados"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const S = {
  root: {
    display:"flex", minHeight:"100vh", background:"#f9fafb", color:"#111827",
    fontFamily:"'Outfit', sans-serif",
  },
  sidebar: {
    width:240, minWidth:240, background:"#ffffff", borderRight:"1px solid #e5e7eb",
    display:"flex", flexDirection:"column", position:"sticky", top:0, height:"100vh",
    overflowY:"auto",
  },
  sidebarHeader: {
    padding:"20px 16px 12px", display:"flex", alignItems:"center", gap:8,
  },
  csmBtn: {
    width:"100%", padding:"10px 12px", border:"none", borderRadius:6,
    cursor:"pointer", textAlign:"left", marginBottom:2, transition:"all 0.15s",
    display:"block", fontFamily:"inherit",
  },
  sidebarFooter: {
    padding:"12px 16px", borderTop:"1px solid #e5e7eb",
  },
  main: {
    flex:1, padding:"24px 32px", overflowY:"auto", maxHeight:"100vh",
  },
  header: {
    display:"flex", justifyContent:"space-between", alignItems:"flex-end",
    marginBottom:20, paddingBottom:16, borderBottom:"1px solid #e5e7eb",
  },
  title: {
    margin:0, fontSize:24, fontWeight:700, color:"#111827", letterSpacing:-0.3,
  },
  subtitle: {
    margin:"4px 0 0", fontSize:13, color:"#6b7280",
    fontFamily:"'JetBrains Mono',monospace",
  },
  kpi: {
    background:"#f3f4f6", borderRadius:8, padding:"10px 16px", minWidth:100, textAlign:"center",
  },
  search: {
    background:"#ffffff", border:"1px solid #e5e7eb", borderRadius:8,
    padding:"8px 14px", color:"#111827", fontSize:13, width:260,
    fontFamily:"'Outfit',sans-serif", outline:"none", transition:"border-color 0.2s",
  },
  tableWrap: {
    borderRadius:10, border:"1px solid #e5e7eb", overflow:"hidden",
  },
  table: {
    width:"100%", borderCollapse:"collapse",
  },
  th: {
    padding:"12px 16px", fontSize:10, fontFamily:"'JetBrains Mono',monospace",
    textTransform:"uppercase", letterSpacing:0.8, background:"#f9fafb",
    borderBottom:"1px solid #e5e7eb", fontWeight:500, whiteSpace:"nowrap",
  },
  tr: {
    borderBottom:"1px solid #f3f4f6", transition:"background 0.15s", cursor:"default",
  },
  td: {
    padding:"12px 16px", verticalAlign:"middle",
  },
};
