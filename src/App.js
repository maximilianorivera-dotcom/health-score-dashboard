import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
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
  verde:     { bg:"#ECFDF5", fg:"#065F46", dot:"#22C48A", label:"Fresco",    desc:"Datos actualizados hace < 30 días" },
  amarillo:  { bg:"#FFFBEB", fg:"#92400E", dot:"#F59E0B", label:"Tibio",     desc:"Última actualización: 30-60 días" },
  rojo:      { bg:"#FEF2F2", fg:"#991B1B", dot:"#EF4444", label:"Stale",     desc:"Datos con > 60 días de antigüedad" },
  sin_fecha: { bg:"#F4F4F6", fg:"#7A7A8C", dot:"#A0A0B0", label:"Sin fecha", desc:"No hay fecha de referencia" },
};

const MOM_C = {
  5:{bg:"#ECFDF5",fg:"#065F46",accent:"#22C48A"},
  4:{bg:"#F0FDF4",fg:"#166534",accent:"#4ADE80"},
  3:{bg:"#F4F4F6",fg:"#7A7A8C",accent:"#A0A0B0"},
  2:{bg:"#FFFBEB",fg:"#92400E",accent:"#F59E0B"},
  1:{bg:"#FEF2F2",fg:"#991B1B",accent:"#EF4444"},
};

// ── Tooltip component ────────────────────────────────────────────
function Tooltip({ children, content, width = 280 }) {
  const [show, setShow]           = useState(false);
  const [ready, setReady]         = useState(false);
  const [placement, setPlacement] = useState("top");
  const [tipPos, setTipPos]       = useState({ x:0, y:0, arrowLeft:"50%", arrowTop:"50%" });
  const anchorRect                = useRef(null);
  const tipRef                    = useRef(null);

  const handleEnter = useCallback((e) => {
    anchorRect.current = e.currentTarget.getBoundingClientRect();
    setReady(false);
    setShow(true);
  }, []);

  // After the tooltip renders (invisible), measure its height and pick direction
  useLayoutEffect(() => {
    if (!show || !tipRef.current) return;
    const a   = anchorRect.current;
    const tipH = tipRef.current.offsetHeight;
    const GAP  = 12;
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;

    const above = a.top;
    const below = vh - a.bottom;
    const right = vw - a.right;
    const left  = a.left;

    let pl;
    if      (above >= tipH + GAP)  pl = "top";
    else if (below >= tipH + GAP)  pl = "bottom";
    else if (right >= width + GAP) pl = "right";
    else if (left  >= width + GAP) pl = "left";
    else {
      const m = Math.max(above, below, right, left);
      pl = m === above ? "top" : m === below ? "bottom" : m === right ? "right" : "left";
    }

    let x, y, arrowLeft = "50%", arrowTop = "50%";

    if (pl === "top" || pl === "bottom") {
      let cx = a.left + a.width / 2;
      cx = Math.max(width / 2 + GAP, Math.min(vw - width / 2 - GAP, cx));
      x = cx;
      y = pl === "top" ? a.top - GAP : a.bottom + GAP;
      const rawPct = ((a.left + a.width / 2) - (cx - width / 2)) / width * 100;
      arrowLeft = `${Math.max(10, Math.min(90, rawPct))}%`;
    } else {
      let cy = a.top + a.height / 2;
      cy = Math.max(tipH / 2 + GAP, Math.min(vh - tipH / 2 - GAP, cy));
      y = cy;
      x = pl === "right" ? a.right + GAP : a.left - GAP;
      const rawPct = ((a.top + a.height / 2) - (cy - tipH / 2)) / tipH * 100;
      arrowTop = `${Math.max(10, Math.min(90, rawPct))}%`;
    }

    setPlacement(pl);
    setTipPos({ x, y, arrowLeft, arrowTop });
    setReady(true);
  }, [show, width]);

  const transforms = {
    top:    "translate(-50%, -100%)",
    bottom: "translate(-50%, 0)",
    right:  "translate(0, -50%)",
    left:   "translate(-100%, -50%)",
  };

  const arrowBase = { position:"absolute", width:10, height:10, background:"#1A1A2E" };
  const arrowStyle = placement === "top"
    ? { ...arrowBase, bottom:-5, left:tipPos.arrowLeft, transform:"translateX(-50%) rotate(45deg)" }
    : placement === "bottom"
    ? { ...arrowBase, top:-5,    left:tipPos.arrowLeft, transform:"translateX(-50%) rotate(45deg)" }
    : placement === "right"
    ? { ...arrowBase, left:-5,   top:tipPos.arrowTop,   transform:"translateY(-50%) rotate(45deg)" }
    : { ...arrowBase, right:-5,  top:tipPos.arrowTop,   transform:"translateY(-50%) rotate(45deg)" };

  return (
    <span
      onMouseEnter={handleEnter}
      onMouseLeave={() => { setShow(false); setReady(false); }}
      style={{ position:"relative", cursor:"default" }}
    >
      {children}
      {show && createPortal(
        <div ref={tipRef} style={{
          position:"fixed", left:tipPos.x, top:tipPos.y,
          transform: transforms[placement],
          width, background:"#1A1A2E", borderRadius:12,
          padding:"16px 18px", zIndex:9999,
          boxShadow:"0 8px 32px rgba(0,0,0,0.24)",
          pointerEvents:"none",
          opacity: ready ? 1 : 0,
          transition:"opacity 0.08s",
          fontFamily:"'Inter',system-ui,sans-serif",
        }}>
          {content}
          <div style={arrowStyle}/>
        </div>,
        document.body
      )}
    </span>
  );
}

// ── Index tooltip content ────────────────────────────────────────
// ── Shared tooltip helpers ───────────────────────────────────────
const TIP_DIVIDER = <div style={{ borderTop:"1px solid rgba(255,255,255,0.07)", margin:"12px 0" }}/>;
const TIP_SECTION = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:600, color:"#6B6B90", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
    {children}
  </div>
);
const tipBadge = (bg, color, label) => (
  <div style={{ display:"inline-block", background:bg, color, borderRadius:20, padding:"4px 10px", fontSize:12, fontWeight:600, lineHeight:1 }}>
    {label}
  </div>
);

function IndexTooltip({ c }) {
  const score = c.index_score;

  const scoreColor = v => v == null ? "#6B6B90" : v >= 8 ? "#22C48A" : v >= 5 ? "#8B8BFF" : "#EF4444";
  const scoreBadge = v => v == null
    ? tipBadge("rgba(255,255,255,0.08)", "#6B6B90", "Sin datos")
    : v >= 8  ? tipBadge("rgba(34,196,138,0.18)",  "#22C48A", "Saludable")
    : v >= 5  ? tipBadge("rgba(91,91,246,0.18)",   "#8B8BFF", "Moderado")
    : tipBadge("rgba(239,68,68,0.18)", "#EF4444", "En riesgo");

  const fbDateStr  = c.feedback_date  ? new Date(c.feedback_date).toLocaleDateString("es-CL")  : null;
  const loyDateStr = c.loyalty_date   ? new Date(c.loyalty_date).toLocaleDateString("es-CL")   : null;
  const loyPts = c.loyalty_value != null ? c.loyalty_value * 2 : null;

  return (
    <div style={{ fontSize:12, color:"#FFFFFF" }}>
      {/* Header */}
      <TIP_SECTION>INDEX</TIP_SECTION>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
          <span style={{ fontSize:28, fontWeight:700, color:"#FFFFFF", lineHeight:1 }}>{score ?? "—"}</span>
          <span style={{ fontSize:16, color:"#6B6B90" }}>/10</span>
        </div>
        {c.override_applied
          ? tipBadge("rgba(245,158,11,0.18)", "#F59E0B", "Dominancia")
          : scoreBadge(score)}
      </div>

      {TIP_DIVIDER}

      {c.override_applied ? (() => {
        const winnerIsLoyalty = c.override_winner === "loyalty";

        const WinnerBlock = winnerIsLoyalty ? (
          <div style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
              <span style={{ fontSize:12, color:"rgba(255,255,255,0.8)" }}>
                ✓ Loyalty <span style={{ color:"#6B6B90", fontSize:11 }}>100%</span>
              </span>
              <span style={{ fontSize:20, fontWeight:700, color:"#22C48A" }}>
                {loyPts ?? "—"}
              </span>
            </div>
            <div style={{ fontSize:11, color:"#6B6B90" }}>
              {c.loyalty_value != null ? `L${c.loyalty_value}` : ""}
              {loyDateStr ? ` — actualizado ${loyDateStr}` : ""}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
              <span style={{ fontSize:12, color:"rgba(255,255,255,0.8)" }}>
                ✓ {c.feedback_source || "Feedback"} <span style={{ color:"#6B6B90", fontSize:11 }}>100%</span>
              </span>
              <span style={{ fontSize:20, fontWeight:700, color:"#22C48A" }}>
                {c.feedback_value ?? "—"}
              </span>
            </div>
            <div style={{ fontSize:11, color:"#6B6B90" }}>
              {fbDateStr ? `Respondido ${fbDateStr}` : ""}
            </div>
          </div>
        );

        const LoserBlock = winnerIsLoyalty ? (
          <div style={{ opacity:0.5, marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
              <span style={{ fontSize:12, color:"#EF4444", textDecoration:"line-through" }}>
                ✗ {c.feedback_source || "Feedback"} ignorado
              </span>
              <span style={{ fontSize:20, fontWeight:700, color:"#EF4444", textDecoration:"line-through" }}>
                {c.feedback_value != null ? `${c.feedback_value}/10` : "—"}
              </span>
            </div>
            <div style={{ fontSize:11, color:"#6B6B90" }}>
              {fbDateStr ? `Respondido ${fbDateStr}` : ""}
            </div>
          </div>
        ) : (
          <div style={{ opacity:0.5, marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
              <span style={{ fontSize:12, color:"#EF4444", textDecoration:"line-through" }}>
                ✗ Loyalty ignorado
              </span>
              <span style={{ fontSize:20, fontWeight:700, color:"#EF4444", textDecoration:"line-through" }}>
                {loyPts ?? "—"}
              </span>
            </div>
            <div style={{ fontSize:11, color:"#6B6B90" }}>
              {c.loyalty_value != null ? `L${c.loyalty_value}` : ""}
              {loyDateStr ? ` — actualizado ${loyDateStr}` : ""}
            </div>
          </div>
        );

        return (
          <>
            {WinnerBlock}
            {LoserBlock}
            {c.override_reason && (
              <div style={{ background:"rgba(245,158,11,0.12)", border:"1px solid rgba(245,158,11,0.25)", borderRadius:8, padding:"8px 10px" }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#F59E0B", marginBottom:4 }}>⚡ Dominancia temporal activa</div>
                <div style={{ fontSize:11, color:"#B0A070", lineHeight:1.5 }}>{c.override_reason}</div>
              </div>
            )}
          </>
        );
      })() : (
        <>
          {/* Loyalty block */}
          <div style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
              <span style={{ fontSize:12, color:"rgba(255,255,255,0.7)" }}>
                Loyalty <span style={{ color:"#6B6B90", fontSize:11 }}>60%</span>
              </span>
              <span style={{ fontSize:20, fontWeight:700, color: loyPts != null ? scoreColor(loyPts) : "#6B6B90" }}>
                {loyPts ?? "—"}
              </span>
            </div>
            <div style={{ fontSize:11, color:"#6B6B90" }}>
              {c.loyalty_value != null ? `L${c.loyalty_value}` : "Sin datos"}
              {c.loyalty_reason ? ` — ${c.loyalty_reason}` : ""}
              {loyDateStr ? ` — actualizado ${loyDateStr}` : ""}
            </div>
          </div>
          {/* Feedback block */}
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
              <span style={{ fontSize:12, color:"rgba(255,255,255,0.7)" }}>
                Feedback <span style={{ color:"#6B6B90", fontSize:11 }}>40%</span>
              </span>
              <span style={{ fontSize:20, fontWeight:700, color: c.feedback_value != null ? scoreColor(c.feedback_value) : "#6B6B90" }}>
                {c.feedback_value ?? "—"}
              </span>
            </div>
            <div style={{ fontSize:11, color:"#6B6B90" }}>
              {c.feedback_source || "Sin fuente"}
              {fbDateStr ? ` — respondido ${fbDateStr}` : ""}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Momentum tooltip content ─────────────────────────────────────
function MomentumTooltip({ c }) {
  const hasMom = c.momentum_score != null;

  const momBadge = score => {
    if (!score) return tipBadge("rgba(255,255,255,0.08)", "#6B6B90", "Sin datos");
    if (score >= 4) return tipBadge("rgba(34,196,138,0.18)", "#22C48A", `${c.momentum_symbol} ${c.momentum_label}`);
    if (score === 3) return tipBadge("rgba(91,91,246,0.18)", "#8B8BFF", `${c.momentum_symbol} ${c.momentum_label}`);
    return tipBadge("rgba(239,68,68,0.18)", "#EF4444", `${c.momentum_symbol} ${c.momentum_label}`);
  };

  const barRow = (label, pct, displayVal) => {
    const clampedPct = Math.min(Math.max(pct, 0), 100);
    const fillColor = clampedPct >= 70 ? "#22C48A" : clampedPct >= 30 ? "#5B5BF6" : "#EF4444";
    return (
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:7 }}>
        <span style={{ fontSize:12, color:"#9090B0", flex:"0 0 110px", whiteSpace:"nowrap" }}>{label}</span>
        <div style={{ flex:"0 0 80px", height:4, background:"rgba(255,255,255,0.1)", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${clampedPct}%`, background:fillColor, borderRadius:2 }}/>
        </div>
        <span style={{ fontSize:13, fontWeight:600, color:fillColor, textAlign:"right", flex:1 }}>{displayVal}</span>
      </div>
    );
  };

  const daPct = c.days_active_30   != null ? (c.days_active_30 / 28) * 100 : 0;
  const vaPct = c.variacion_pct    != null ? ((c.variacion_pct + 100) / 200) * 100 : 50;
  const prPct = c.proyeccion_sobre_limite != null ? c.proyeccion_sobre_limite * 100 : 0;

  const actividadOk = c.days_since_last_use === 0 || (c.days_since_last_use != null && c.days_since_last_use <= 14);
  const actividadTxt = c.days_since_last_use === 0
    ? "Activo hoy"
    : c.days_since_last_use != null
      ? `Sin actividad hace ${c.days_since_last_use} días`
      : "Sin dato";

  return (
    <div style={{ fontSize:12, color:"#FFFFFF" }}>
      {/* Header */}
      <TIP_SECTION>MOMENTUM</TIP_SECTION>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
          <span style={{ fontSize:28, fontWeight:700, color:"#FFFFFF", lineHeight:1 }}>{hasMom ? c.momentum_score : "—"}</span>
          <span style={{ fontSize:16, color:"#6B6B90" }}>/5</span>
        </div>
        <div style={{ textAlign:"right" }}>
          {momBadge(c.momentum_score)}
          {hasMom && (
            <div style={{ fontSize:11, color:"#6B6B90", marginTop:4 }}>raw {c.momentum_raw}</div>
          )}
        </div>
      </div>

      {TIP_DIVIDER}

      {/* Señales de uso */}
      <TIP_SECTION>Señales de uso</TIP_SECTION>
      {barRow("Días activos /30d", daPct,
        c.days_active_30 != null ? `${c.days_active_30}d` : "—")}
      {barRow("Variación convos", vaPct,
        c.variacion_pct != null ? `${c.variacion_pct > 0 ? "+" : ""}${c.variacion_pct}%` : "—")}
      {barRow("Uso / límite plan", prPct,
        c.proyeccion_sobre_limite != null ? `${(c.proyeccion_sobre_limite * 100).toFixed(0)}%` : "—")}

      {TIP_DIVIDER}

      {/* Penalidades */}
      <TIP_SECTION>Penalidades</TIP_SECTION>
      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ width:7, height:7, borderRadius:"50%", background: c.pago_rechazado ? "#EF4444" : "#22C48A", flexShrink:0 }}/>
          <span style={{ fontSize:12, color: c.pago_rechazado ? "#EF4444" : "#22C48A" }}>
            {c.pago_rechazado ? "Pago rechazado" : "Pago al día"}
          </span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ width:7, height:7, borderRadius:"50%", background: actividadOk ? "#22C48A" : "#EF4444", flexShrink:0 }}/>
          <span style={{ fontSize:12, color: actividadOk ? "#22C48A" : "#EF4444" }}>{actividadTxt}</span>
        </div>
      </div>
    </div>
  );
}

// ── Freshness tooltip content ────────────────────────────────────
function FreshnessTooltip({ c }) {
  const f = c.freshness ? FRESH[c.freshness] : null;
  const dias = c.freshness_days ?? null;
  const barWidth = dias != null ? Math.min((dias / 90) * 100, 100) : 0;

  const contextText = (() => {
    if (!f) return "No hay datos de Index para evaluar frescura.";
    if (c.freshness === "verde") return "Datos de Loyalty y Feedback actualizados recientemente.";
    if (c.freshness === "amarillo") {
      const src = c.feedback_source || "El dato";
      return `${src} actualizado hace ${dias != null ? `${dias} días` : "más de 30 días"}. Considera actualizar el Index pronto.`;
    }
    return "Datos desactualizados. El Index puede no reflejar la situación actual del cliente.";
  })();

  return (
    <div style={{ fontSize:12, color:"#FFFFFF" }}>
      {/* Header */}
      <TIP_SECTION>FRESHNESS</TIP_SECTION>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:2 }}>
        <div>
          <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
            <span style={{ fontSize:32, fontWeight:700, color: f ? f.dot : "#6B6B90", lineHeight:1 }}>
              {dias ?? "—"}
            </span>
          </div>
          <div style={{ fontSize:13, color:"#9090B0", marginTop:2 }}>días desde última actualización</div>
        </div>
        {f && tipBadge(
          c.freshness === "verde"    ? "rgba(34,196,138,0.18)"  :
          c.freshness === "amarillo" ? "rgba(245,158,11,0.18)"  :
                                       "rgba(239,68,68,0.18)",
          f.dot, f.label
        )}
      </div>

      {/* Progress bar */}
      <div style={{ height:6, background:"rgba(255,255,255,0.08)", borderRadius:3, margin:"10px 0 6px", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${barWidth}%`, background: f ? f.dot : "#6B6B90", borderRadius:3, transition:"width 0.4s ease" }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#6B6B90", marginBottom:0 }}>
        <span>0d</span><span>30d</span><span>60d</span><span>90d+</span>
      </div>

      {TIP_DIVIDER}

      {/* Contextual text */}
      <div style={{ fontSize:11, color:"#9090B0", lineHeight:1.5, marginBottom:12 }}>{contextText}</div>

      {/* Legend */}
      <div style={{ display:"flex", gap:12 }}>
        {[
          { dot:"#22C48A", label:"Fresco <30d" },
          { dot:"#F59E0B", label:"Tibio 30–60d" },
          { dot:"#EF4444", label:"Stale 60d+" },
        ].map(({ dot, label }) => (
          <div key={label} style={{ display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:dot, flexShrink:0 }}/>
            <span style={{ fontSize:11, color:"#9090B0" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Index mini gauge ─────────────────────────────────────────────
function IndexDot({ value, overrideApplied }) {
  if (value == null) return <span style={{ color:"#A0A0B0", fontSize:13 }}>—</span>;
  const color = value >= 8 ? "#22C48A" : value >= 6 ? "#3B82F6" : value >= 4 ? "#F59E0B" : "#EF4444";
  const pct = Math.min(value/10, 1);
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ position:"relative", display:"inline-flex" }}>
        <div style={{ width:36, height:36, position:"relative" }}>
          <svg width={36} height={36} viewBox="0 0 36 36" style={{ transform:"rotate(-90deg)" }}>
            <circle cx={18} cy={18} r={14} fill="none" stroke="#F4F4F6" strokeWidth={3}/>
            <circle cx={18} cy={18} r={14} fill="none" stroke={color} strokeWidth={3}
              strokeDasharray={`${87.96*pct} ${87.96*(1-pct)}`}
              strokeLinecap="round"
              style={{ transition:"stroke-dasharray 0.6s ease" }}/>
          </svg>
          <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color, fontFamily:"'Inter',system-ui,sans-serif" }}>
            {value}
          </span>
        </div>
        {overrideApplied && (
          <span style={{ position:"absolute", top:-4, right:-6, width:14, height:14, borderRadius:"50%", background:"#F59E0B", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#1A1A2E", lineHeight:1 }}>
            i
          </span>
        )}
      </div>
    </div>
  );
}

// ── Momentum badge ───────────────────────────────────────────────
function MomentumBadge({ score, symbol, label }) {
  if (score == null) return <span style={{ color:"#A0A0B0", fontSize:13 }}>—</span>;
  const mc = MOM_C[score];
  return (
    <div style={{ display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:6, background:mc.bg }}>
      <span style={{ fontSize:15, color:mc.accent, lineHeight:1, fontWeight:500 }}>{symbol}</span>
    </div>
  );
}

// ── Freshness badge ──────────────────────────────────────────────
function FreshBadge({ freshness }) {
  if (!freshness) return <span style={{ color:"#A0A0B0", fontSize:13 }}>—</span>;
  const f = FRESH[freshness];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:6, background:f.bg, color:f.fg, fontSize:11, fontWeight:500 }}>
      <span style={{ width:8, height:8, borderRadius:"50%", background:f.dot, flexShrink:0 }}/>
      {f.label}
    </span>
  );
}

// ── WA quality tooltip ──────────────────────────────────────────
const WA_RATING_ORDER = { RED: 0, YELLOW: 1, GREEN: 2, UNKNOWN: 3 };
const waRatingDot  = r => r === "RED" ? "#EF4444" : r === "YELLOW" ? "#F59E0B" : r === "GREEN" ? "#22C48A" : "#A0A0B0";
const waRatingText = r => r === "RED" ? "#EF4444" : r === "YELLOW" ? "#F59E0B" : "#22C48A";

function WATooltip({ c }) {
  const phones = [...(c.wa_phones || [])].sort(
    (a, b) => (WA_RATING_ORDER[a.quality_rating] ?? 3) - (WA_RATING_ORDER[b.quality_rating] ?? 3)
  );

  return (
    <div style={{ fontSize:12, color:"#FFFFFF" }}>
      <TIP_SECTION>Calidad WhatsApp</TIP_SECTION>
      {phones.length === 0 ? (
        <div style={{ fontSize:12, color:"#6B6B90" }}>Sin números registrados</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column" }}>
          {phones.map((p, i) => {
            const dateStr = p.wa_quality_date
              ? new Date(p.wa_quality_date).toLocaleDateString("es-CL") : null;
            return (
              <div key={p.phone_id || i}>
                {i > 0 && <div style={{ borderTop:"1px solid rgba(255,255,255,0.07)", margin:"8px 0" }}/>}
                <div style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
                  <span style={{
                    width:7, height:7, borderRadius:"50%", flexShrink:0, marginTop:3,
                    background: waRatingDot(p.quality_rating),
                  }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:500, color:"#FFFFFF", marginBottom:1 }}>
                      {p.verified_name || p.display_number}
                    </div>
                    {p.verified_name && (
                      <div style={{ fontSize:11, color:"#6B6B90", marginBottom:4 }}>{p.display_number}</div>
                    )}
                    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                      <span style={{ fontSize:11, fontWeight:600, color: waRatingText(p.quality_rating) }}>
                        {p.quality_rating}{p.quality_score != null ? ` · ${p.quality_score}` : ""}
                      </span>
                      {p.messaging_limit && (
                        <span style={{ fontSize:10, color:"#9090B0" }}>{p.messaging_limit}</span>
                      )}
                      {p.phone_status && p.phone_status !== "CONNECTED" && (
                        <span style={{ fontSize:10, color:"#EF4444" }}>{p.phone_status}</span>
                      )}
                      {dateStr && (
                        <span style={{ fontSize:10, color:"#6B6B90" }}>{dateStr}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── WA quality badge ─────────────────────────────────────────────
function WABadge({ c }) {
  if (!(c.wa_phones?.length > 0)) return null;
  const STYLES = {
    RED:    { bg:"#FEF2F2", color:"#991B1B", dot:"#EF4444",  label:"WA ✕" },
    YELLOW: { bg:"#FFFBEB", color:"#92400E", dot:"#F59E0B",  label:"WA ⚠" },
    GREEN:  { bg:"#ECFDF5", color:"#065F46", dot:"#22C48A",  label:"WA"   },
  };
  const s = STYLES[c.wa_quality_rating] ?? STYLES.GREEN;
  return (
    <Tooltip content={<WATooltip c={c}/>} width={260}>
      <span style={{
        display:"inline-flex", alignItems:"center", gap:3,
        padding:"2px 6px", borderRadius:6, fontSize:10, fontWeight:600,
        background: s.bg, color: s.color, cursor:"default",
      }}>
        <span style={{ width:5, height:5, borderRadius:"50%", background: s.dot, flexShrink:0 }}/>
        {s.label}
      </span>
    </Tooltip>
  );
}

// ══════════════════════════════════════════════════════════════════
//  MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════
export default function HealthDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("team");
  const [selectedCSM, setSelectedCSM] = useState(null);
  const [sortKeys, setSortKeys] = useState([{ key:"mrr", dir:"desc" }]);
  const [search, setSearch] = useState("");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [waFilter, setWaFilter] = useState(false);

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
    setSortKeys(prev => {
      const idx = prev.findIndex(s => s.key === key);
      if (idx === 0) {
        // Click primario: toggle dir, limpia secundario
        return [{ key, dir: prev[0].dir === "desc" ? "asc" : "desc" }];
      } else if (idx === 1) {
        // Click secundario: toggle dir
        const next = [...prev];
        next[1] = { key, dir: prev[1].dir === "desc" ? "asc" : "desc" };
        return next;
      } else {
        // Columna inactiva: el nuevo click es primario, el primario anterior pasa a secundario
        if (prev.length === 0) return [{ key, dir:"desc" }];
        return [{ key, dir:"desc" }, prev[0]];
      }
    });
  }, []);

  const clients = useMemo(() => {
    let list = data.filter(c => (c.csm || "Sin asignar") === selectedCSM);
    if (sizeFilter !== "all") list = list.filter(c => (c.client_size || "M") === sizeFilter);
    if (waFilter) list = list.filter(c => c.wa_quality_alert === true);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => (c.client_name||"").toLowerCase().includes(q) || (c.email||"").toLowerCase().includes(q));
    }
    const getValue = (c, key) => {
      switch (key) {
        case "mrr":      return c.mrr || 0;
        case "index":    return c.index_score ?? -999;
        case "momentum": return c.momentum_score ?? -999;
        case "freshness": return { verde:4, amarillo:3, rojo:2, sin_fecha:1 }[c.freshness] || 0;
        case "name":     return null;
        default:         return 0;
      }
    };
    list.sort((a, b) => {
      for (const { key, dir } of sortKeys) {
        const d = dir === "desc" ? -1 : 1;
        if (key === "name") {
          const cmp = (a.client_name||"").localeCompare(b.client_name||"");
          if (cmp !== 0) return d * cmp;
        } else {
          const va = getValue(a, key), vb = getValue(b, key);
          if (va !== vb) return d * (va - vb);
        }
      }
      return 0;
    });
    return list;
  }, [data, selectedCSM, search, sortKeys, sizeFilter, waFilter]);

  const teamStats = useMemo(() => {
    const withIdx = data.filter(c => c.index_score != null);
    const withMom = data.filter(c => c.momentum_score != null);
    return {
      total: data.length,
      avgIndex: withIdx.length ? Math.round(withIdx.reduce((s,c) => s+c.index_score,0)/withIdx.length*10)/10 : null,
      avgMom: withMom.length ? Math.round(withMom.reduce((s,c) => s+c.momentum_score,0)/withMom.length*10)/10 : null,
      atRisk: data.filter(c => (c.index_score != null && c.index_score <= 4) || (c.momentum_score != null && c.momentum_score <= 1)).length,
      inactive: data.filter(c => c.days_since_last_use != null && c.days_since_last_use > 30).length,
    };
  }, [data]);

  const csmTableData = useMemo(() => {
    const map = {};
    data.forEach(c => {
      const name = c.csm || "Sin asignar";
      if (!map[name]) map[name] = { name, clients:[] };
      map[name].clients.push(c);
    });
    return Object.values(map).map(({ name, clients }) => {
      const withIdx = clients.filter(c => c.index_score != null);
      const withMom = clients.filter(c => c.momentum_score != null);
      const green  = clients.filter(c => c.index_score != null && c.index_score >= 7).length;
      const yellow = clients.filter(c => c.index_score != null && c.index_score >= 4 && c.index_score < 7).length;
      const red    = clients.filter(c => c.index_score == null || c.index_score < 4).length;
      return {
        name,
        count: clients.length,
        mrr: clients.reduce((s,c) => s+(c.mrr||0),0),
        avgIndex: withIdx.length ? Math.round(withIdx.reduce((s,c) => s+c.index_score,0)/withIdx.length*10)/10 : null,
        avgMom: withMom.length ? Math.round(withMom.reduce((s,c) => s+c.momentum_score,0)/withMom.length*10)/10 : null,
        atRisk: clients.filter(c => (c.index_score != null && c.index_score <= 4) || (c.momentum_score != null && c.momentum_score <= 1)).length,
        dist: { green, yellow, red, total: clients.length },
      };
    }).sort((a,b) => b.mrr - a.mrr);
  }, [data]);

  const alertClients = useMemo(() =>
    [...data].filter(c => c.index_score != null).sort((a,b) => a.index_score - b.index_score).slice(0,10),
  [data]);

  const csmStats = useMemo(() => {
    let list = data.filter(c => (c.csm||"Sin asignar") === selectedCSM);
    if (sizeFilter !== "all") list = list.filter(c => (c.client_size || "M") === sizeFilter);
    const withIdx = list.filter(c => c.index_score != null);
    const withMom = list.filter(c => c.momentum_score != null);
    return {
      count: list.length,
      mrr: list.reduce((s,c) => s+(c.mrr||0), 0),
      avgIndex: withIdx.length ? Math.round(withIdx.reduce((s,c) => s+c.index_score, 0)/withIdx.length*10)/10 : null,
      avgMom: withMom.length ? Math.round(withMom.reduce((s,c) => s+c.momentum_score, 0)/withMom.length*10)/10 : null,
      critical: list.filter(c => (c.index_score != null && c.index_score <= 4) || (c.momentum_score != null && c.momentum_score <= 1)).length,
      waAlerts: list.filter(c => c.wa_quality_alert === true).length,
    };
  }, [data, selectedCSM, sizeFilter]);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#F4F4F6", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
      <div style={{ width:36, height:36, borderRadius:"50%", border:"3px solid #E5E5E8", borderTopColor:"#5B5BF6", animation:"spin 0.8s linear infinite" }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ minHeight:"100vh", background:"#F4F4F6", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <p style={{ color:"#EF4444", fontFamily:"'Inter',system-ui,sans-serif" }}>Error: {error}</p>
    </div>
  );

  const SortHeader = ({ label, sortId, align = "center" }) => {
    const idx = sortKeys.findIndex(s => s.key === sortId);
    const isPrimary = idx === 0;
    const isSecondary = idx === 1;
    const active = idx >= 0;
    const dir = active ? sortKeys[idx].dir : "desc";
    return (
      <th onClick={() => handleSort(sortId)} title={isPrimary ? "Click para cambiar dirección (limpia secundario)" : isSecondary ? "Click para cambiar dirección" : "Click para ordenar · si ya hay un orden activo, agrega como secundario"} style={{ ...S.th, textAlign:align, cursor:"pointer", userSelect:"none", color: isPrimary ? "#5B5BF6" : isSecondary ? "#3B82F6" : "#A0A0B0", transition:"color 0.2s" }}>
        {label}
        {isSecondary && <span style={{ marginLeft:2, fontSize:8, color:"#3B82F6", verticalAlign:"super" }}>2</span>}
        <span style={{ marginLeft:4, fontSize:9, opacity: active ? 1 : 0 }}>
          {dir === "desc" ? "▼" : "▲"}
        </span>
      </th>
    );
  };

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet"/>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        *::-webkit-scrollbar{width:6px;height:6px}
        *::-webkit-scrollbar-track{background:#F4F4F6}
        *::-webkit-scrollbar-thumb{background:#E5E5E8;border-radius:3px}
        *::-webkit-scrollbar-thumb:hover{background:#A0A0B0}
        input:focus{border-color:#5B5BF6 !important;outline:none}
      `}</style>

      {/* ── Left sidebar: CSM list ─────────────────────────────── */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <span style={{ color:"#5B5BF6", fontSize:18 }}>⬡</span>
          <span style={{ fontWeight:600, fontSize:15, color:"#FFFFFF", letterSpacing:-0.3 }}>Health Score</span>
        </div>
        <div style={{ padding:"0 12px 12px", display:"flex", gap:4 }}>
          {[["Equipo","team"],["Cartera","csm"]].map(([label,mode]) => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              flex:1, padding:"6px 0", borderRadius:20, border: viewMode===mode ? "none" : "1px solid rgba(255,255,255,0.12)",
              cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:500,
              background: viewMode===mode ? "#5B5BF6" : "transparent",
              color: viewMode===mode ? "#FFFFFF" : "#6B6B85",
              transition:"all 0.15s",
            }}>{label}</button>
          ))}
        </div>
        <div style={{ padding:"0 12px 10px", fontSize:11, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:"0.05em", fontWeight:500 }}>
          Success Managers
        </div>
        <nav style={{ flex:1, overflowY:"auto", padding:"0 8px" }}>
          {csms.map((csm, i) => {
            const active = csm.name === selectedCSM;
            return (
              <button key={csm.name} onClick={() => { setSelectedCSM(csm.name); setViewMode("csm"); }} style={{
                ...S.csmBtn,
                background: active ? "rgba(91,91,246,0.15)" : "transparent",
                borderLeft: active ? "2px solid #5B5BF6" : "2px solid transparent",
                animation: `slideIn 0.3s ease ${i*0.04}s both`,
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontWeight: active ? 600 : 400, color: active ? "#FFFFFF" : "#6B6B85", fontSize:13 }}>
                    {csm.name}
                  </span>
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)", fontWeight:500 }}>
                    {csm.count}
                  </span>
                </div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:2 }}>
                  {fmtCLP(csm.mrr)}
                </div>
              </button>
            );
          })}
        </nav>
        <div style={S.sidebarFooter}>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>
            {!WEBHOOK_URL ? "MOCK DATA" : "LIVE"} · {data.length} cuentas
          </div>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────── */}
      {viewMode === "team" ? (
        <main style={S.main}>
          <header style={{ ...S.header, flexDirection:"column", alignItems:"flex-start", gap:16 }}>
            <div>
              <h1 style={S.title}>Vista Equipo</h1>
              <p style={S.subtitle}>{teamStats.total} clientes · {data.length > 0 ? fmtCLP(data.reduce((s,c)=>s+(c.mrr||0),0)) : "—"} MRR total</p>
            </div>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
              {[
                { label:"Total Clientes",    value: teamStats.total,    color:"#1A1A2E" },
                { label:"Avg Index",         value: teamStats.avgIndex != null ? teamStats.avgIndex+"/10" : "—", color:"#5B5BF6" },
                { label:"Avg Momentum",      value: teamStats.avgMom != null ? teamStats.avgMom+"/5" : "—", color:"#3B82F6" },
                { label:"En Riesgo",         value: teamStats.atRisk,   color: teamStats.atRisk > 0 ? "#EF4444" : "#22C48A" },
                { label:"Sin Actividad +30d",value: teamStats.inactive, color: teamStats.inactive > 0 ? "#F59E0B" : "#22C48A" },
              ].map(kpi => (
                <div key={kpi.label} style={S.kpi}>
                  <div style={{ fontSize:11, color:"#A0A0B0", textTransform:"uppercase", letterSpacing:"0.05em", fontWeight:500 }}>{kpi.label}</div>
                  <div style={{ fontSize:20, fontWeight:600, color:kpi.color }}>{kpi.value}</div>
                </div>
              ))}
            </div>
          </header>

          <div style={{ display:"flex", gap:24, alignItems:"flex-start" }}>
            {/* CSM table */}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:500, color:"#A0A0B0", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:10 }}>Success Managers</div>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={{ ...S.th, textAlign:"left" }}>CSM</th>
                      <th style={S.th}>Clientes</th>
                      <th style={S.th}>Avg Index</th>
                      <th style={S.th}>Avg Mom</th>
                      <th style={S.th}>En riesgo</th>
                      <th style={{ ...S.th, textAlign:"left", minWidth:140 }}>Distribución Index</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csmTableData.map((csm, i) => (
                      <tr key={csm.name} style={{ ...S.tr, cursor:"pointer", animation:`fadeIn 0.3s ease ${i*0.04}s both` }}
                          onClick={() => { setSelectedCSM(csm.name); setViewMode("csm"); }}
                          onMouseOver={e => e.currentTarget.style.background="#F8F8FA"}
                          onMouseOut={e => e.currentTarget.style.background="transparent"}>
                        <td style={{ ...S.td, fontWeight:600, color:"#1A1A2E", fontSize:13 }}>{csm.name}</td>
                        <td style={{ ...S.td, textAlign:"center", fontSize:13, color:"#7A7A8C", fontWeight:500 }}>{csm.count}</td>
                        <td style={{ ...S.td, textAlign:"center" }}>
                          <span style={{ fontWeight:600, fontSize:13,
                            color: csm.avgIndex == null ? "#A0A0B0" : csm.avgIndex >= 7 ? "#22C48A" : csm.avgIndex >= 4 ? "#F59E0B" : "#EF4444" }}>
                            {csm.avgIndex ?? "—"}
                          </span>
                        </td>
                        <td style={{ ...S.td, textAlign:"center" }}>
                          <span style={{ fontWeight:600, fontSize:13,
                            color: csm.avgMom == null ? "#A0A0B0" : csm.avgMom >= 4 ? "#22C48A" : csm.avgMom >= 3 ? "#F59E0B" : "#EF4444" }}>
                            {csm.avgMom ?? "—"}
                          </span>
                        </td>
                        <td style={{ ...S.td, textAlign:"center" }}>
                          {csm.atRisk > 0
                            ? <span style={{ background:"#FEF2F2", color:"#991B1B", fontSize:11, fontWeight:500, padding:"2px 8px", borderRadius:6 }}>{csm.atRisk}</span>
                            : <span style={{ color:"#A0A0B0" }}>—</span>}
                        </td>
                        <td style={{ ...S.td }}>
                          {csm.dist.total > 0 && (
                            <>
                              <div style={{ display:"flex", height:8, borderRadius:4, overflow:"hidden", gap:1 }}>
                                {csm.dist.green  > 0 && <div style={{ flex:csm.dist.green,  background:"#16a34a" }}/>}
                                {csm.dist.yellow > 0 && <div style={{ flex:csm.dist.yellow, background:"#ca8a04" }}/>}
                                {csm.dist.red    > 0 && <div style={{ flex:csm.dist.red,    background:"#dc2626" }}/>}
                              </div>
                              <div style={{ fontSize:10, color:"#A0A0B0", marginTop:3 }}>
                                {csm.dist.green}v · {csm.dist.yellow}a · {csm.dist.red}r
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Alert panel */}
            <div style={{ width:300, flexShrink:0 }}>
              <div style={{ fontSize:11, fontWeight:500, color:"#A0A0B0", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:10 }}>Alertas — Peor Index</div>
              <div style={{ ...S.tableWrap, borderRadius:10 }}>
                {alertClients.map((c, i) => (
                  <div key={c.client_id} onClick={() => { setSelectedCSM(c.csm||"Sin asignar"); setViewMode("csm"); }}
                       style={{ padding:"10px 14px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", animation:`fadeIn 0.3s ease ${i*0.04}s both` }}
                       onMouseOver={e => e.currentTarget.style.background="#F8F8FA"}
                       onMouseOut={e => e.currentTarget.style.background="transparent"}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:500, fontSize:12, color:"#1A1A2E", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.client_name}</div>
                      <div style={{ fontSize:10, color:"#A0A0B0", marginTop:1 }}>{c.csm || "Sin asignar"}</div>
                    </div>
                    <div style={{ display:"flex", gap:6, alignItems:"center", marginLeft:8 }}>
                      <span style={{ fontWeight:600, fontSize:14,
                        color: c.index_score >= 7 ? "#22C48A" : c.index_score >= 4 ? "#F59E0B" : "#EF4444" }}>
                        {c.index_score}
                      </span>
                      <MomentumBadge score={c.momentum_score} symbol={c.momentum_symbol} label={c.momentum_label}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      ) : (
        <main style={S.main}>
          {/* CSM header */}
          <header style={S.header}>
            <div>
              <h1 style={S.title}>{selectedCSM}</h1>
              <p style={S.subtitle}>{csmStats.count} cuentas · {fmtCLP(csmStats.mrr)} MRR</p>
            </div>
            <div style={{ display:"flex", gap:12 }}>
              {[
                { label:"Avg Index",    value: csmStats.avgIndex != null ? csmStats.avgIndex+"/10" : "—", color:"#5B5BF6" },
                { label:"Avg Momentum", value: csmStats.avgMom != null ? csmStats.avgMom+"/5" : "—",      color:"#3B82F6" },
                { label:"Críticos",     value: csmStats.critical, color: csmStats.critical > 0 ? "#EF4444" : "#22C48A" },
                { label:"Alertas WA",   value: csmStats.waAlerts, color: csmStats.waAlerts  > 0 ? "#F59E0B" : "#22C48A" },
              ].map(kpi => (
                <div key={kpi.label} style={S.kpi}>
                  <div style={{ fontSize:11, color:"#A0A0B0", textTransform:"uppercase", letterSpacing:"0.05em", fontWeight:500 }}>{kpi.label}</div>
                  <div style={{ fontSize:22, fontWeight:600, color:kpi.color }}>{kpi.value}</div>
                </div>
              ))}
            </div>
          </header>

          {/* Search + Size filter + WA filter */}
          <div style={{ marginBottom:16, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <input type="text" placeholder="Buscar cliente…" value={search} onChange={e => setSearch(e.target.value)} style={S.search}/>
            <div style={{ display:"flex", gap:4 }}>
              {[["Todos","all"],["M","M"],["L","L"]].map(([label, val]) => {
                const isActive = sizeFilter === val;
                return (
                  <button key={val} onClick={() => setSizeFilter(val)} style={{
                    padding:"4px 14px", borderRadius:20, border: isActive ? "none" : "1px solid #E5E5E8",
                    background: isActive ? "#5B5BF6" : "transparent", color: isActive ? "#FFFFFF" : "#7A7A8C",
                    fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"inherit",
                    transition:"all 0.15s",
                  }}>{label}</button>
                );
              })}
            </div>
            <button onClick={() => setWaFilter(v => !v)} style={{
              padding:"4px 14px", borderRadius:20, border: waFilter ? "none" : "1px solid #E5E5E8",
              background: waFilter ? "#F59E0B" : "transparent", color: waFilter ? "#FFFFFF" : "#7A7A8C",
              fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"inherit",
              transition:"all 0.15s",
            }}>WA ⚠</button>
          </div>

          {/* Table */}
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <SortHeader label="Cliente" sortId="name" align="left"/>
                  <SortHeader label="MRR" sortId="mrr" align="right"/>
                  <SortHeader label="Index" sortId="index"/>
                  <SortHeader label="Freshness" sortId="freshness"/>
                  <SortHeader label="Momentum" sortId="momentum"/>
                </tr>
              </thead>
              <tbody>
                {clients.map((c, i) => (
                  <tr key={c.client_id} style={{ ...S.tr, animation:`fadeIn 0.3s ease ${i*0.03}s both` }}
                      onMouseOver={e => { e.currentTarget.style.background="#F8F8FA"; }}
                      onMouseOut={e => { e.currentTarget.style.background="transparent"; }}>
                    <td style={{ ...S.td, maxWidth:240 }}>
                      <a href={c.backofficeUrl} target="_blank" rel="noopener noreferrer"
                         style={{ fontWeight:500, color:"#1A1A2E", fontSize:13, textDecoration:"none", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", display:"block" }}
                         onMouseOver={e => e.target.style.color="#5B5BF6"}
                         onMouseOut={e => e.target.style.color="#1A1A2E"}>
                        {c.client_name}
                      </a>
                      <div style={{ fontSize:11, color:"#A0A0B0", marginTop:1 }}>{c.email}</div>
                      <div style={{ fontSize:11, color:"#7A7A8C", marginTop:1 }}>{c.plan} · {c.country}</div>
                    </td>
                    <td style={{ ...S.td, textAlign:"right", fontSize:13, fontWeight:500, color:"#1A1A2E" }}>
                      {fmtCLP(c.mrr)}
                    </td>
                    <td style={{ ...S.td, textAlign:"center" }}>
                      <Tooltip content={<IndexTooltip c={c}/>} width={280}>
                        <IndexDot value={c.index_score} overrideApplied={c.override_applied}/>
                      </Tooltip>
                    </td>
                    <td style={{ ...S.td, textAlign:"center" }}>
                      <Tooltip content={<FreshnessTooltip c={c}/>} width={280}>
                        <FreshBadge freshness={c.freshness}/>
                      </Tooltip>
                    </td>
                    <td style={{ ...S.td, textAlign:"center" }}>
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                        <Tooltip content={<MomentumTooltip c={c}/>} width={280}>
                          <MomentumBadge score={c.momentum_score} symbol={c.momentum_symbol} label={c.momentum_label}/>
                        </Tooltip>
                        <WABadge c={c}/>
                      </div>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr><td colSpan={6} style={{ ...S.td, textAlign:"center", color:"#9ca3af", padding:40 }}>
                    {search ? "Sin resultados" : "Sin clientes asignados"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const S = {
  root: {
    display:"flex", minHeight:"100vh", background:"#F4F4F6", color:"#1A1A2E",
    fontFamily:"'Inter', system-ui, sans-serif",
  },
  sidebar: {
    width:240, minWidth:240, background:"#1A1A2E",
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
    padding:"12px 16px", borderTop:"1px solid rgba(255,255,255,0.08)",
  },
  main: {
    flex:1, padding:"24px 32px", overflowY:"auto", maxHeight:"100vh",
  },
  header: {
    display:"flex", justifyContent:"space-between", alignItems:"flex-end",
    marginBottom:20, paddingBottom:16, borderBottom:"1px solid #E5E5E8",
  },
  title: {
    margin:0, fontSize:24, fontWeight:600, color:"#1A1A2E", letterSpacing:-0.3,
  },
  subtitle: {
    margin:"4px 0 0", fontSize:13, color:"#7A7A8C",
  },
  kpi: {
    background:"#FFFFFF", border:"1px solid #E5E5E8", borderRadius:12,
    padding:"10px 16px", minWidth:100, textAlign:"center",
  },
  search: {
    background:"#FFFFFF", border:"1px solid #E5E5E8", borderRadius:8,
    padding:"0 14px", color:"#1A1A2E", fontSize:13, width:260, height:36,
    fontFamily:"'Inter',system-ui,sans-serif", outline:"none", transition:"border-color 0.2s",
    boxSizing:"border-box",
  },
  tableWrap: {
    borderRadius:12, border:"1px solid #E5E5E8", overflow:"hidden", background:"#FFFFFF",
  },
  table: {
    width:"100%", borderCollapse:"collapse",
  },
  th: {
    padding:"12px 16px", fontSize:11, fontFamily:"'Inter',system-ui,sans-serif",
    textTransform:"uppercase", letterSpacing:"0.05em", background:"#F8F8FA",
    borderBottom:"1px solid #E5E5E8", fontWeight:500, whiteSpace:"nowrap", color:"#A0A0B0",
  },
  tr: {
    borderBottom:"1px solid #F0F0F3", transition:"background 0.15s", cursor:"default",
  },
  td: {
    padding:"14px 16px", verticalAlign:"middle",
  },
};
