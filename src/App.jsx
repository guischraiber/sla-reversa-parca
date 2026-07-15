import { useState, useMemo, useCallback, useEffect } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell, Legend } from "recharts";

// ── Cores ─────────────────────────────────────────────────────────────────────
const C = {
  laranja:"#F97316",laranjaLight:"#FED7AA",verde:"#16A34A",verdeLight:"#BBF7D0",
  vermelho:"#DC2626",vermelhoLight:"#FEE2E2",amarelo:"#CA8A04",amareloLight:"#FEF08A",
  azul:"#2563EB",azulLight:"#DBEAFE",roxo:"#7C3AED",roxoLight:"#EDE9FE",
  cinzaFundo:"#F8F7F4",cinzaCard:"#FFFFFF",cinzaBorda:"#E5E3DF",cinzaTexto:"#6B7280",texto:"#1C1917",
};

// ── Indicadores ────────────────────────────────────────────────────────────────
const INDICADORES = [
  {key:"sla",  spKey:"sla_sp",  label:"SLA Reversa", meta:86, inv:false, unit:"%"},
  {key:"agend",spKey:"agend_sp",label:"Agendamento",  meta:95, inv:false, unit:"%"},
  {key:"ader", spKey:"ader_sp", label:"Aderência",    meta:95, inv:false, unit:"%"},
  {key:"sla15",spKey:"sla15_sp",label:"SLA 15 dias",  meta:90, inv:false, unit:"%"},
  {key:"aging",spKey:"aging_sp",label:"Aging Médio",  meta:7,  inv:true,  unit:"d"},
];

const MESES_NOME = {1:"Jan",2:"Fev",3:"Mar",4:"Abr",5:"Mai",6:"Jun",7:"Jul",8:"Ago",9:"Set",10:"Out",11:"Nov",12:"Dez"};
const TRIM_MESES = {1:[1,2,3],2:[4,5,6],3:[7,8,9],4:[10,11,12]};
const PARC_CORES = ["#F97316","#2563EB","#16A34A","#7C3AED","#CA8A04","#DC2626","#0891B2","#D97706","#9333EA","#059669"];
const FAIXAS_AGING = [
  {label:"≥ 5d",  min:5,  max:9,  cor:C.amarelo,  bg:C.amareloLight},
  {label:"≥ 10d", min:10, max:14, cor:C.laranja,  bg:"#FFF7ED"},
  {label:"≥ 15d", min:15, max:19, cor:C.roxo,     bg:C.roxoLight},
  {label:"≥ 20d", min:20, max:24, cor:C.vermelho, bg:C.vermelhoLight},
  {label:"≥ 25d", min:25, max:999,cor:"#7F1D1D",  bg:"#FEE2E2"},
];

// ── Helpers ────────────────────────────────────────────────────────────────────
const norm = s => {
  if(s==null) return "";
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
};
const pct = (n,t) => t>0 ? Math.round(n/t*10000)/100 : null;
const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*100)/100 : null;
const sem = (v, meta, inv) => {
  if(v==null) return C.cinzaBorda;
  if(!inv) return v>=meta?C.verde:v>=meta*0.95?C.amarelo:C.vermelho;
  return v<=meta?C.verde:v<=meta*1.15?C.amarelo:C.vermelho;
};

// ── CSV Parser ─────────────────────────────────────────────────────────────────
const parseCSV = (text) => {
  const sep = text.split("\n")[0].includes(";") ? ";" : ",";
  // Parser que lida com campos multilinhas (texto com \n dentro de aspas)
  const rows = [];
  let cur = "", inQ = false, fields = [], i = 0;
  const raw = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  while(i <= raw.length){
    const ch = raw[i];
    if(ch === '"'){
      if(inQ && raw[i+1] === '"'){ cur += '"'; i+=2; continue; }
      inQ = !inQ; i++; continue;
    }
    if((ch === sep || ch === undefined) && !inQ){
      fields.push(cur.trim()); cur = "";
      if(ch === undefined || raw[i+1] === undefined){ rows.push(fields); fields = []; }
      i++; continue;
    }
    if(ch === "\n" && !inQ){
      fields.push(cur.trim()); cur = "";
      rows.push(fields); fields = [];
      i++; continue;
    }
    cur += (ch===undefined?"":ch); i++;
  }
  if(fields.length>0) rows.push(fields);
  const headers = rows[0]||[];
  return rows.slice(1)
    .filter(r=>r.some(v=>v!==""))
    .map(vals=>{
      const row={};
      headers.forEach((h,i)=>{ row[h.trim()]=(vals[i]??"").replace(/^"|"$/g,""); });
      return row;
    });
};

// ── Feriados nacionais BR 2026 ────────────────────────────────────────────────
const FERIADOS_2026 = new Set([
  "2026-01-01","2026-02-16","2026-02-17","2026-02-18", // Ano Novo, Carnaval
  "2026-04-03","2026-04-05",                            // Sexta-Feira Santa, Páscoa
  "2026-04-21","2026-05-01","2026-06-04",               // Tiradentes, Trabalho, Corpus Christi
  "2026-09-07","2026-10-12","2026-11-02",               // Independência, Ap., Finados
  "2026-11-15","2026-11-20","2026-12-25",               // Rep., Consciência Negra, Natal
]);

const busdays = (d1Str, d2Str) => {
  if(!d1Str||!d2Str||d1Str==="--"||d2Str==="--") return null;
  try {
    const [d1d,d1m,d1y]=d1Str.split("/"); const dt1=new Date(d1y,d1m-1,d1d);
    const [d2d,d2m,d2y]=d2Str.split("/"); const dt2=new Date(d2y,d2m-1,d2d);
    if(isNaN(dt1)||isNaN(dt2)||dt2<dt1) return null;
    let dias=0, cur=new Date(dt1);
    while(cur<dt2){
      const dow=cur.getDay();
      const iso=cur.toISOString().slice(0,10);
      if(dow!==0&&dow!==6&&!FERIADOS_2026.has(iso)) dias++;
      cur.setDate(cur.getDate()+1);
    }
    return dias;
  } catch{ return null; }
};

// ── calcSemana ─────────────────────────────────────────────────────────────────
const calcSemana = (rows) => {
  const base = rows.filter(r=>r["Flag Situacao Coleta"]==="Coletado");
  if(base.length<3) return null;
  const sp   = base.filter(r=>r["Problema_de_coleta"]!=="1"&&r["Problema_de_coleta"]!==1&&r["Problema_de_coleta"]!==true);
  const isNao    = r=>norm(r["Vencido"])==="Nao";
  const isNao15  = r=>norm(r["Vencido (SLA Cliente)"])==="Nao";
  const isAg     = r=>r["Agendamento"]==="1"||r["Agendamento"]===1;
  const isAder   = r=>{const v=r["Aderencia agendamento "]??r["Aderencia agendamento"];return v==="1"||v===1;};
  const agOk     = base.filter(isAg);
  const agOkSp   = sp.filter(isAg);

  // Aging em dias úteis — calcular via busdays (excl. feriados e fins de semana)
  const agingList = base.map(r=>{
    const bd=busdays(r["Data Solicitacao Date"],r["Data Coleta Efetivada Date"]);
    if(bd!==null) return bd;
    const v=parseFloat(r["Aging coleta efetivada"]); // fallback
    return !isNaN(v)&&v>=0?v:null;
  }).filter(v=>v!==null);
  const agingSpList = sp.map(r=>{
    const bd=busdays(r["Data Solicitacao Date"],r["Data Coleta Efetivada Date"]);
    if(bd!==null) return bd;
    const v=parseFloat(r["Aging coleta efetivada"]);
    return !isNaN(v)&&v>=0?v:null;
  }).filter(v=>v!==null);

  return {
    total:    base.length,
    total_sp: sp.length,
    sla:      pct(base.filter(isNao).length,   base.length),
    sla_sp:   pct(sp.filter(isNao).length,     sp.length),
    agend:    pct(base.filter(isAg).length,    base.length),
    agend_sp: pct(sp.filter(isAg).length,      sp.length),
    ader:     pct(agOk.filter(isAder).length,  agOk.length),
    ader_sp:  pct(agOkSp.filter(isAder).length,agOkSp.length),
    sla15:    pct(base.filter(isNao15).length, base.length),
    sla15_sp: pct(sp.filter(isNao15).length,   sp.length),
    aging:    avg(agingList),
    aging_sp: avg(agingSpList),
    prob:     base.filter(r=>r["Problema_de_coleta"]==="1"||r["Problema_de_coleta"]===1).length,
  };
};

// ── Chip ───────────────────────────────────────────────────────────────────────
const Chip = ({v, m, inv, unit}) => {
  if(v==null) return <span style={{color:C.cinzaTexto}}>—</span>;
  const cor = sem(v,m,inv);
  const bg  = cor===C.verde?C.verdeLight:cor===C.amarelo?C.amareloLight:C.vermelhoLight;
  const fmt = unit==="d" ? `${Math.round(v)}d` : `${v.toFixed(1)}%`;
  return <span style={{fontWeight:700,color:cor,background:bg,padding:"2px 8px",borderRadius:6,fontSize:12}}>{fmt}</span>;
};

// ══════════════════════════════════════════════════════════════════════════════
// Componente AbaProblemas
// ══════════════════════════════════════════════════════════════════════════════
const AbaProblemas = ({rawRows, filtrarPorPeriodo, sel, lbl}) => {
  const [parcSel, setParcSel] = useState([]);

  const parcs = useMemo(()=>[...new Set(
    rawRows.filter(r=>r["Flag Situacao Coleta"]==="Coletado"&&(r["Problema_de_coleta"]==="1"||r["Problema_de_coleta"]===1))
      .map(r=>r["Transportadora"]).filter(Boolean)
  )].sort(),[rawRows]);

  useEffect(()=>{ if(parcs.length>0) setParcSel(parcs); },[parcs.join(",")]);

  const sm=(on,cor)=>({padding:"3px 8px",fontSize:11,borderRadius:999,border:`1.5px solid ${on?cor:C.cinzaBorda}`,background:on?`${cor}18`:"transparent",cursor:"pointer",fontWeight:600,color:on?cor:C.cinzaTexto});

  const ACOES_P = {"Cliente ausente":"Acionar cliente 24h antes","Telefone Inválido":"Atualizar contato","NF errada":"Verificar documentação","Cliente desistiu":"Contato preventivo","Endereço não localizado":"Validar endereço"};

  const base = useMemo(()=>
    filtrarPorPeriodo(rawRows.filter(r=>r["Flag Situacao Coleta"]==="Coletado"&&(r["Problema_de_coleta"]==="1"||r["Problema_de_coleta"]===1)))
      .filter(r=>parcSel.length===0||parcSel.includes(r["Transportadora"]))
  ,[rawRows,filtrarPorPeriodo,parcSel]);

  const totalProb = base.length;
  const comAtraso = base.filter(r=>norm(r["Vencido"])==="Sim").length;

  const motGeralMap = {};
  base.forEach(r=>{
    const m=r["Problema Motivo"]||"Sem motivo";
    if(!motGeralMap[m])motGeralMap[m]={c:0,a:0};
    motGeralMap[m].c++; if(norm(r["Vencido"])==="Sim")motGeralMap[m].a++;
  });
  const motGeral = Object.entries(motGeralMap).sort((a,b)=>b[1].c-a[1].c);

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>

    {/* Filtro parceiros */}
    <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3}}>Parceiros</div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setParcSel(parcs)} style={{fontSize:11,color:C.azul,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Todos</button>
          <button onClick={()=>setParcSel([])}    style={{fontSize:11,color:C.cinzaTexto,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Nenhum</button>
        </div>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
        {parcs.map((p,i)=><button key={p} onClick={()=>setParcSel(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p])} style={sm(parcSel.includes(p),PARC_CORES[i%PARC_CORES.length])}>{p.split(" ")[0]}</button>)}
      </div>
    </div>

    {/* KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
      {[
        {l:"Total de problemas",v:totalProb.toLocaleString("pt-BR"),c:C.laranja},
        {l:"Com atraso (Vencido=Sim)",v:comAtraso.toLocaleString("pt-BR"),c:C.vermelho},
        {l:"Sem atraso",v:(totalProb-comAtraso).toLocaleString("pt-BR"),c:C.verde},
        {l:"% com atraso",v:totalProb>0?`${Math.round(comAtraso/totalProb*100)}%`:"—",c:C.amarelo},
      ].map(({l,v,c},i)=>(
        <div key={i} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:"14px 18px",borderLeft:`4px solid ${c}`}}>
          <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",marginBottom:4}}>{l}</div>
          <div style={{fontSize:26,fontWeight:800,color:c,lineHeight:1}}>{v}</div>
        </div>
      ))}
    </div>

    {/* Ranking geral */}
    <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13}}>
        Ranking de Motivos — {sel.map(p=>lbl(p)).join(", ")}
      </div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:C.cinzaFundo}}>{["Motivo","Ocorr.","% total","c/ Atraso","% c/ atraso","Ação sugerida"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:["Motivo","Ação sugerida"].includes(h)?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{motGeral.map(([mot,v],i)=>(
          <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
            <td style={{padding:"8px 12px",fontWeight:500}}>{mot}</td>
            <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700}}>{v.c}</td>
            <td style={{padding:"8px 12px",textAlign:"center",color:C.cinzaTexto}}>{Math.round(v.c/totalProb*100)}%</td>
            <td style={{padding:"8px 12px",textAlign:"center",color:v.a>0?C.vermelho:C.cinzaTexto,fontWeight:v.a>0?700:400}}>{v.a}</td>
            <td style={{padding:"8px 12px",textAlign:"center",color:v.a>0?C.vermelho:C.cinzaTexto}}>{v.c>0?`${Math.round(v.a/v.c*100)}%`:"—"}</td>
            <td style={{padding:"8px 12px",fontSize:11,color:C.azul}}>{ACOES_P[mot]||"Investigar causa"}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>

    {/* Por parceiro — tabela resumo */}
    {parcs.length>0&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13}}>Por Parceiro</div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:C.cinzaFundo}}>{["Parceiro","Problemas","% total","c/ Atraso","% c/ atraso","Motivo principal"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:["Parceiro","Motivo principal"].includes(h)?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{parcs.filter(p=>parcSel.includes(p)).map((p,i)=>{
          const rowsP=base.filter(r=>r["Transportadora"]===p);
          if(!rowsP.length) return null;
          const atr=rowsP.filter(r=>norm(r["Vencido"])==="Sim").length;
          const motP={};rowsP.forEach(r=>{const m=r["Problema Motivo"]||"Sem motivo";motP[m]=(motP[m]||0)+1;});
          const topMot=Object.entries(motP).sort((a,b)=>b[1]-a[1])[0];
          return <tr key={p} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
            <td style={{padding:"8px 12px",fontWeight:600,color:PARC_CORES[i%PARC_CORES.length]}}>{p}</td>
            <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700,color:C.laranja}}>{rowsP.length}</td>
            <td style={{padding:"8px 12px",textAlign:"center",color:C.cinzaTexto}}>{Math.round(rowsP.length/totalProb*100)}%</td>
            <td style={{padding:"8px 12px",textAlign:"center",color:atr>0?C.vermelho:C.cinzaTexto,fontWeight:atr>0?700:400}}>{atr}</td>
            <td style={{padding:"8px 12px",textAlign:"center",color:atr>0?C.vermelho:C.cinzaTexto}}>{rowsP.length>0?`${Math.round(atr/rowsP.length*100)}%`:"—"}</td>
            <td style={{padding:"8px 12px",fontSize:11,color:C.cinzaTexto}}>{topMot?`${topMot[0]} (${topMot[1]})`:"—"}</td>
          </tr>;
        }).filter(Boolean)}</tbody>
      </table></div>
    </div>}

    {/* Detalhe por parceiro */}
    {parcs.filter(p=>parcSel.includes(p)).map((p,pi)=>{
      const rowsP=base.filter(r=>r["Transportadora"]===p);
      if(!rowsP.length) return null;
      const motP={};
      rowsP.forEach(r=>{const m=r["Problema Motivo"]||"Sem motivo";if(!motP[m])motP[m]={c:0,a:0,cids:{}};motP[m].c++;if(norm(r["Vencido"])==="Sim")motP[m].a++;const c=r["Cidade"]||"N/A";motP[m].cids[c]=(motP[m].cids[c]||0)+1;});
      return <div key={p} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
        <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13,color:PARC_CORES[pi%PARC_CORES.length]}}>
          {p} — {rowsP.length} problemas · {rowsP.filter(r=>norm(r["Vencido"])==="Sim").length} com atraso
        </div>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{background:C.cinzaFundo}}>{["Motivo","Ocorr.","c/ Atraso","Cidade principal","Ação sugerida"].map(h=><th key={h} style={{padding:"7px 12px",textAlign:["Motivo","Cidade principal","Ação sugerida"].includes(h)?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>{Object.entries(motP).sort((a,b)=>b[1].c-a[1].c).map(([mot,v],i)=>(
            <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
              <td style={{padding:"7px 12px",fontWeight:500}}>{mot}</td>
              <td style={{padding:"7px 12px",textAlign:"center",fontWeight:700}}>{v.c}</td>
              <td style={{padding:"7px 12px",textAlign:"center",color:v.a>0?C.vermelho:C.cinzaTexto,fontWeight:v.a>0?700:400}}>{v.a}</td>
              <td style={{padding:"7px 12px",fontSize:11,color:C.cinzaTexto}}>{Object.entries(v.cids).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—"}</td>
              <td style={{padding:"7px 12px",fontSize:11,color:C.azul}}>{ACOES_P[mot]||"Investigar causa"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>;
    }).filter(Boolean)}
  </div>;
};

// ══════════════════════════════════════════════════════════════════════════════
// Componente AbaAtrasos (precisa de hooks próprios — componente separado)
// ══════════════════════════════════════════════════════════════════════════════
const AbaAtrasos = ({rawRows, filtrarPorPeriodo, sel, lbl}) => {
  const [parcSel, setParcSel] = useState([]);

  const parcs = useMemo(()=>[...new Set(
    rawRows.filter(r=>r["Transportadora"]).map(r=>r["Transportadora"]).filter(Boolean)
  )].sort(),[rawRows]);

  useEffect(()=>{ if(parcs.length>0) setParcSel(parcs); },[parcs.join(",")]);

  const pill=(on,cor=C.laranja)=>({padding:"4px 12px",borderRadius:999,border:`1.5px solid ${on?cor:C.cinzaBorda}`,background:on?`${cor}18`:"transparent",cursor:"pointer",fontSize:12,fontWeight:600,color:on?cor:C.cinzaTexto});
  const sm=(on,cor)=>({...pill(on,cor),padding:"3px 8px",fontSize:11});

  // Coletados fora do SLA: Vencido=Sim + tem data de coleta
  const base = useMemo(()=>
    filtrarPorPeriodo(rawRows.filter(r=>
      r["Flag Situacao Coleta"]==="Coletado" &&
      norm(r["Vencido"])==="Sim" &&
      r["Data Coleta Efetivada Date"] && r["Data Coleta Efetivada Date"]!=="--" && r["Data Coleta Efetivada Date"]!==""
    )).filter(r=>parcSel.length===0||parcSel.includes(r["Transportadora"]))
  ,[rawRows, filtrarPorPeriodo, parcSel]);

  const comAging = useMemo(()=>base.map(r=>{
    const d1=r["Data Solicitacao Date"], d2=r["Data Coleta Efetivada Date"];
    if(!d1||d1==="--"||!d2||d2==="--") return null;
    const dias=busdays(d1,d2);
    return dias!=null&&dias>=0?{...r,diasAtraso:dias}:null;
  }).filter(Boolean),[base]);

  const porFaixa = FAIXAS_AGING.map(f=>({...f,count:comAging.filter(r=>r.diasAtraso>=f.min&&r.diasAtraso<=f.max).length}));
  const total = comAging.length;
  const parcComDados = parcs.filter(p=>comAging.some(r=>r["Transportadora"]===p));

  const topCidades = useMemo(()=>{
    if(!comAging.length) return [];
    const cidMap={};
    comAging.forEach(r=>{
      const key=`${r["Cidade"]||"N/A"} (${r["Estado"]||""})`;
      if(!cidMap[key])cidMap[key]={total:0,parc:{}};
      cidMap[key].total++;
      const p=r["Transportadora"]||"—"; cidMap[key].parc[p]=(cidMap[key].parc[p]||0)+1;
    });
    return Object.entries(cidMap).filter(([,v])=>v.total>=3)
      .map(([loc,v])=>({loc,total:v.total,top:Object.entries(v.parc).sort((a,b)=>b[1]-a[1])[0]}))
      .sort((a,b)=>b.total-a.total).slice(0,10);
  },[comAging]);

  const faixaLabel = dias => {
    if(dias>=25) return {label:"≥ 25d", cor:"#7F1D1D", bg:"#FEE2E2"};
    if(dias>=20) return {label:"≥ 20d", cor:C.vermelho, bg:C.vermelhoLight};
    if(dias>=15) return {label:"≥ 15d", cor:C.roxo,    bg:C.roxoLight};
    if(dias>=10) return {label:"≥ 10d", cor:C.laranja,  bg:"#FFF7ED"};
    return          {label:"≥ 5d",  cor:C.amarelo, bg:C.amareloLight};
  };

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>

    {/* Filtro parceiros */}
    <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3}}>
          Parceiros · <span style={{color:C.vermelho}}>Coletados fora do SLA (Vencido = Sim)</span> · Aging em dias úteis
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setParcSel(parcs)} style={{fontSize:11,color:C.azul,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Todos</button>
          <button onClick={()=>setParcSel([])}    style={{fontSize:11,color:C.cinzaTexto,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Nenhum</button>
        </div>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
        {parcs.map((p,i)=><button key={p} onClick={()=>setParcSel(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p])} style={sm(parcSel.includes(p),PARC_CORES[i%PARC_CORES.length])}>{p.split(" ")[0]}</button>)}
      </div>
    </div>

    {/* KPIs por faixa */}
    <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:18}}>
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>
        ✓ Coletados fora do SLA
        <span style={{fontSize:12,color:C.cinzaTexto,fontWeight:400,marginLeft:8}}>{total} pedidos · {sel.map(p=>lbl(p)).join(", ")}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
        {porFaixa.map((f,i)=>(
          <div key={i} style={{background:f.bg,borderRadius:10,padding:"12px 14px",borderLeft:`4px solid ${f.cor}`}}>
            <div style={{fontSize:11,fontWeight:700,color:f.cor,marginBottom:4}}>{f.label}</div>
            <div style={{fontSize:30,fontWeight:800,color:f.cor,lineHeight:1}}>{f.count}</div>
            <div style={{fontSize:11,color:C.cinzaTexto,marginTop:4}}>{total>0?Math.round(f.count/total*100):0}%</div>
          </div>
        ))}
      </div>
    </div>

    {/* Por parceiro */}
    {parcComDados.length>0&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13}}>Por Parceiro</div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:C.cinzaFundo}}>{["Parceiro","Total",...FAIXAS_AGING.map(f=>f.label)].map(h=><th key={h} style={{padding:"8px 12px",textAlign:h==="Parceiro"?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{parcComDados.map((p,i)=>{
          const rows=comAging.filter(r=>r["Transportadora"]===p);
          return <tr key={p} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
            <td style={{padding:"8px 12px",fontWeight:600}}>{p}</td>
            <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700,color:C.vermelho}}>{rows.length}</td>
            {FAIXAS_AGING.map((f,fi)=>{const n=rows.filter(r=>r.diasAtraso>=f.min&&r.diasAtraso<=f.max).length;return <td key={fi} style={{padding:"8px 12px",textAlign:"center"}}>{n>0?<span style={{fontWeight:700,color:f.cor,background:f.bg,padding:"2px 8px",borderRadius:6}}>{n}</span>:<span style={{color:C.cinzaTexto}}>—</span>}</td>;})}
          </tr>;
        })}</tbody>
      </table></div>
    </div>}

    {/* Top Cidades */}
    {topCidades.length>0&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13}}>🗺️ Top Cidades — Mais atrasos</div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:C.cinzaFundo}}>{["#","Cidade / Estado","Atrasos","Principal parceiro"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:["Cidade / Estado","Principal parceiro"].includes(h)?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{topCidades.map((c,i)=>(
          <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
            <td style={{padding:"7px 12px",textAlign:"center",fontWeight:700,color:C.vermelho}}>{i+1}</td>
            <td style={{padding:"7px 12px",fontWeight:600}}>{c.loc}</td>
            <td style={{padding:"7px 12px",textAlign:"center",fontWeight:800,color:C.vermelho,fontSize:15}}>{c.total}</td>
            <td style={{padding:"7px 12px",fontSize:12,color:C.cinzaTexto}}>{c.top&&<span>{c.top[0].split(" ")[0]} <span style={{color:C.vermelho,fontWeight:700}}>({c.top[1]})</span></span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>}

    {/* Detalhe */}
    <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontWeight:700,fontSize:13}}>Detalhe dos Pedidos</span>
        <span style={{fontSize:12,color:C.cinzaTexto}}>{total} pedidos · maior atraso primeiro</span>
      </div>
      <div style={{overflowX:"auto",maxHeight:440,overflowY:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead style={{position:"sticky",top:0,zIndex:1}}>
            <tr style={{background:C.cinzaFundo}}>
              {["Pedido","Parceiro","Cidade","UF","Dias úteis","Classificação","Solicitação","Data Coleta","Prob. Coleta"].map(h=>
                <th key={h} style={{padding:"7px 12px",textAlign:["Dias úteis"].includes(h)?"center":"left",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {[...comAging].sort((a,b)=>b.diasAtraso-a.diasAtraso).map((r,i)=>{
              const f=faixaLabel(r.diasAtraso);
              const temProb=r["Problema_de_coleta"]==="1"||r["Problema_de_coleta"]===1;
              return <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
                <td style={{padding:"6px 12px",fontWeight:600,fontFamily:"monospace",fontSize:11}}>{r["Pv"]||"—"}</td>
                <td style={{padding:"6px 12px",fontSize:11}}>{(r["Transportadora"]||"").split(" ")[0]}</td>
                <td style={{padding:"6px 12px",color:C.cinzaTexto,fontSize:11}}>{r["Cidade"]||"—"}</td>
                <td style={{padding:"6px 12px",color:C.cinzaTexto,fontSize:11}}>{r["Estado"]||"—"}</td>
                <td style={{padding:"6px 12px",textAlign:"center",fontWeight:800,color:f.cor,fontSize:13}}>{r.diasAtraso}d</td>
                <td style={{padding:"6px 12px"}}>
                  <span style={{fontWeight:700,color:f.cor,background:f.bg,padding:"2px 10px",borderRadius:6,fontSize:11,whiteSpace:"nowrap"}}>{f.label}</span>
                </td>
                <td style={{padding:"6px 12px",color:C.cinzaTexto,fontSize:11}}>{r["Data Solicitacao Date"]||"—"}</td>
                <td style={{padding:"6px 12px",color:C.cinzaTexto,fontSize:11}}>{r["Data Coleta Efetivada Date"]||"—"}</td>
                <td style={{padding:"6px 12px",fontSize:11}}>
                  {temProb
                    ?<span style={{background:C.vermelhoLight,color:C.vermelho,padding:"1px 8px",borderRadius:4,fontWeight:700,fontSize:10}}>⚠️ Sim</span>
                    :<span style={{color:C.cinzaTexto}}>—</span>
                  }
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
};

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// Componente AbaRelatorios
// ══════════════════════════════════════════════════════════════════════════════
const AbaRelatorios = ({rawRows,weeklyMerged,pdMerged,monthlyData,parceirosDisp,sel,lbl,granular,semFiltro,INDICADORES_R,PARC_CORES_R,FAIXAS_AGING_R,busdays_r,norm_r,pct_r}) => {
  const [tipoRel,     setTipoRel]     = useState("atrasos");
  const [parcSel,     setParcSel]     = useState([]);
  const [semSel,      setSemSel]      = useState([]);
  const [mesSel,      setMesSel]      = useState([]);
  const [colsSel,     setColsSel]     = useState(INDICADORES_R.map(i=>i.key));
  const [inclAtrasos, setInclAtrasos] = useState(true);
  const [faixaSel,    setFaixaSel]    = useState(["5","10","15","20","25"]);

  const todasSemanas = weeklyMerged.map(w=>w.s);
  const todosMeses   = monthlyData.map(d=>d.m);
  const MESES_N = {1:"Jan",2:"Fev",3:"Mar",4:"Abr",5:"Mai",6:"Jun",7:"Jul",8:"Ago",9:"Set",10:"Out",11:"Nov",12:"Dez"};

  useEffect(()=>{
    if(parceirosDisp.length>0&&parcSel.length===0) setParcSel(parceirosDisp);
    if(todasSemanas.length>0&&semSel.length===0)   setSemSel(todasSemanas.slice(-4));
    if(todosMeses.length>0&&mesSel.length===0)     setMesSel(todosMeses);
  },[parceirosDisp.join(","),todasSemanas.join(","),todosMeses.join(",")]);

  const pill2=(on,cor=C.laranja)=>({padding:"4px 12px",borderRadius:999,border:`1.5px solid ${on?cor:C.cinzaBorda}`,background:on?`${cor}18`:"transparent",cursor:"pointer",fontSize:12,fontWeight:600,color:on?cor:C.cinzaTexto});
  const sm2=(on,cor=C.laranja)=>({...pill2(on,cor),padding:"3px 8px",fontSize:11});
  const escCSV=v=>{const s=String(v??"");return s.includes(";")||s.includes('"')?`"${s.replace(/"/g,'""')}"`:s;};
  const dlCSV=(rows2,nome)=>{const csv=rows2.map(r=>r.map(escCSV).join(";")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));a.download=`${nome}_${new Date().toISOString().slice(0,10)}.csv`;a.click();};

  const getAtrasos = (parceiros2) => {
    if(!rawRows.length) return [];
    return rawRows.filter(r=>
      r["Flag Situacao Coleta"]==="Coletado" &&
      norm_r(r["Vencido"])==="Sim" &&
      r["Data Coleta Efetivada Date"] && r["Data Coleta Efetivada Date"]!=="--" &&
      (parceiros2.length===0||parceiros2.includes(r["Transportadora"])) &&
      (semSel.length===0||semSel.includes(parseInt(r["semana_Efetivada"])))
    ).map(r=>{const d=busdays_r(r["Data Solicitacao Date"],r["Data Coleta Efetivada Date"]);return d!=null&&d>=0?{...r,diasAtraso:d}:null;})
    .filter(Boolean).sort((a,b)=>b.diasAtraso-a.diasAtraso);
  };

  const faixaLbl=dias=>dias>=25?"≥ 25d":dias>=20?"≥ 20d":dias>=15?"≥ 15d":dias>=10?"≥ 10d":"≥ 5d";
  const faixaCls=dias=>dias>=25?"f25":dias>=20?"f20":dias>=15?"f15":dias>=10?"f10":"f5";
  const chipCls=(v,meta,inv)=>{if(v==null)return"";if(!inv)return v>=meta?"verde":v>=meta*0.95?"amarelo":"vermelho";return v<=meta?"verde":v<=meta*1.15?"amarelo":"vermelho";};
  const fmt=(v,i)=>v==null?"—":i.inv?`${Math.round(v)}${i.unit}`:`${v.toFixed(1)}${i.unit}`;

  const CSS_BASE = `body{font-family:Arial,sans-serif;padding:24px;color:#1C1917}h1{color:#F97316;font-size:22px;margin-bottom:4px}h2{font-size:13px;color:#6B7280;margin-bottom:20px;font-weight:400}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}th{background:#F8F7F4;padding:7px 10px;font-size:10px;text-transform:uppercase;color:#6B7280;border-bottom:2px solid #E5E3DF;text-align:center}th:first-child{text-align:left}td{padding:6px 10px;border-bottom:1px solid #E5E3DF;text-align:center}td:first-child{text-align:left}tr:nth-child(even){background:#F8F7F4}.chip{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;font-size:11px}.verde{background:#BBF7D0;color:#16A34A}.vermelho{background:#FEE2E2;color:#DC2626}.amarelo{background:#FEF08A;color:#CA8A04}.f5{background:#FEF08A;color:#CA8A04}.f10{background:#FFF7ED;color:#F97316}.f15{background:#EDE9FE;color:#7C3AED}.f20{background:#FEE2E2;color:#DC2626}.f25{background:#FEE2E2;color:#7F1D1D}.prob{background:#FEE2E2;color:#DC2626;padding:1px 8px;border-radius:4px;font-size:10px;font-weight:700}.section-title{font-size:13px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 8px;border-bottom:1px solid #E5E3DF;padding-bottom:5px}@media print{@page{margin:14mm}}`;

  const openPrint = html => { const w=window.open("","_blank"); w.document.write(html); w.document.close(); };

  const gerarAtrasos = (fmt2) => {
    const base = getAtrasos(parcSel);
    const ativos = faixaSel.map(Number);
    const filtrado = base.filter(r=>ativos.some(f=>r.diasAtraso>=f));
    if(fmt2==="csv"){
      const FAIXAS_CSV = [{min:5,max:9,l:"≥ 5d"},{min:10,max:14,l:"≥ 10d"},{min:15,max:19,l:"≥ 15d"},{min:20,max:24,l:"≥ 20d"},{min:25,max:999,l:"≥ 25d"}];
      const parcUnicosCSV = [...new Set(filtrado.map(r=>r["Transportadora"]).filter(Boolean))].sort();
      dlCSV([
        // Aba 1: resumo por parceiro × faixa
        ["=== RESUMO POR PARCEIRO ==="],
        ["Parceiro","Total",...FAIXAS_CSV.map(f=>f.l)],
        ...parcUnicosCSV.map(p=>{const rp=filtrado.filter(r=>r["Transportadora"]===p);return[p,rp.length,...FAIXAS_CSV.map(f=>rp.filter(r=>r.diasAtraso>=f.min&&r.diasAtraso<=f.max).length)];}),
        [],
        ["=== DETALHE DOS PEDIDOS ==="],
        ["Pedido","Parceiro","Cidade","UF","Semana","Dias Úteis","Classificação","Data Solicitação","Data Coleta","Problema"],
        ...filtrado.map(r=>[r["Pv"]||"",r["Transportadora"]||"",r["Cidade"]||"",r["Estado"]||"",`S${r["semana_Efetivada"]}`,r.diasAtraso,faixaLbl(r.diasAtraso),r["Data Solicitacao Date"]||"",r["Data Coleta Efetivada Date"]||"",r["Problema_de_coleta"]==="1"||r["Problema_de_coleta"]===1?"Sim":"Não"])
      ],"relatorio_atrasos");
    } else {
      // Resumo por faixa
      const FAIXAS_DEF = [{min:5,max:9,l:"≥ 5d",cls:"f5"},{min:10,max:14,l:"≥ 10d",cls:"f10"},{min:15,max:19,l:"≥ 15d",cls:"f15"},{min:20,max:24,l:"≥ 20d",cls:"f20"},{min:25,max:999,l:"≥ 25d",cls:"f25"}];
      const resumoFaixas = FAIXAS_DEF.map(f=>({...f, n:filtrado.filter(r=>r.diasAtraso>=f.min&&r.diasAtraso<=f.max).length})).filter(f=>f.n>0);
      // Resumo por parceiro × faixa
      const parcUnicos = [...new Set(filtrado.map(r=>r["Transportadora"]).filter(Boolean))].sort();
      openPrint(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Atrasos</title><style>${CSS_BASE}
        .resumo{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
        .kpi{border:1px solid #E5E3DF;border-radius:8px;padding:10px 16px;text-align:center}
        .kpi-label{font-size:10px;color:#6B7280;text-transform:uppercase;margin-bottom:4px}
        .kpi-val{font-size:24px;font-weight:800}
        h3{font-size:14px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 8px;border-bottom:1px solid #E5E3DF;padding-bottom:5px}
      </style></head><body>
        <h1>⏰ Relatório de Atrasos — Parça</h1>
        <h2>Parceiros: ${parcSel.join(", ")} · Semanas: S${semSel.join(", S")} · ${new Date().toLocaleDateString("pt-BR")}</h2>
        <h3>Resumo por Faixa de Aging</h3>
        <div class="resumo">
          <div class="kpi"><div class="kpi-label">Total atrasos</div><div class="kpi-val" style="color:#F97316">${filtrado.length}</div></div>
          ${resumoFaixas.map(f=>`<div class="kpi"><div class="kpi-label">${f.l}</div><div class="kpi-val"><span class="chip ${f.cls}">${f.n}</span></div></div>`).join("")}
        </div>
        <h3>Resumo por Parceiro</h3>
        <table><thead><tr><th>Parceiro</th><th>Total</th>${FAIXAS_DEF.map(f=>`<th>${f.l}</th>`).join("")}</tr></thead>
        <tbody>${parcUnicos.map((p,i)=>{
          const rp=filtrado.filter(r=>r["Transportadora"]===p);
          return `<tr style="${i%2===1?'background:#F8F7F4':''}"><td style="font-weight:600">${p}</td><td style="text-align:center;font-weight:700;color:#DC2626">${rp.length}</td>${FAIXAS_DEF.map(f=>{const n=rp.filter(r=>r.diasAtraso>=f.min&&r.diasAtraso<=f.max).length;return`<td style="text-align:center">${n>0?`<span class="chip ${f.cls}">${n}</span>`:"—"}</td>`;}).join("")}</tr>`;
        }).join("")}</tbody></table>
        <h3>Detalhe dos Pedidos</h3>
        <table><thead><tr><th>Pedido</th><th>Parceiro</th><th>Cidade</th><th>UF</th><th>Semana</th><th>Dias úteis</th><th>Classificação</th><th>Solicitação</th><th>Coleta</th><th>Prob.</th></tr></thead>
        <tbody>${filtrado.map(r=>`<tr><td style="font-family:monospace;font-size:11px">${r["Pv"]||""}</td><td>${(r["Transportadora"]||"").split(" ")[0]}</td><td>${r["Cidade"]||""}</td><td>${r["Estado"]||""}</td><td>S${r["semana_Efetivada"]}</td><td style="font-weight:800">${r.diasAtraso}d</td><td><span class="chip ${faixaCls(r.diasAtraso)}">${faixaLbl(r.diasAtraso)}</span></td><td>${r["Data Solicitacao Date"]||""}</td><td>${r["Data Coleta Efetivada Date"]||""}</td><td>${r["Problema_de_coleta"]==="1"||r["Problema_de_coleta"]===1?'<span class="prob">⚠️ Sim</span>':"—"}</td></tr>`).join("")}</tbody>
        </table><script>window.print();window.close();</script></body></html>`);
    }
  };

  const gerarPainel = (fmt2) => {
    const inds = INDICADORES_R.filter(i=>colsSel.includes(i.key));
    const dados = parcSel.map(p=>({
      p, rows2: semSel.map(s=>{const d=pdMerged[p]?.[s];return d?{s,...d}:null;}).filter(Boolean)
    }));
    if(fmt2==="csv"){
      dlCSV([["Parceiro","Semana","Coletas",...inds.map(i=>i.label),"Problemas"],
        ...dados.flatMap(({p,rows2})=>rows2.map(r=>[p,`S${r.s}`,r.total,...inds.map(i=>{const v=r[semFiltro?i.spKey:i.key];return v!=null?`${v.toFixed(1)}${i.unit}`:"—";}),r.prob||0]))
      ],"relatorio_indicadores");
    } else {
      openPrint(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Indicadores</title><style>${CSS_BASE}.parc{margin-bottom:28px;page-break-inside:avoid}.ptitle{font-size:16px;font-weight:800;color:#F97316;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #FED7AA}</style></head><body>
        <h1>📊 Indicadores por Parceiro — Parça</h1>
        <h2>Semanas: S${semSel.join(", S")} · ${new Date().toLocaleDateString("pt-BR")}</h2>
        ${dados.map(({p,rows2})=>`<div class="parc"><div class="ptitle">${p}</div>
          ${rows2.length===0?'<p style="color:#6B7280;font-style:italic">Sem dados.</p>':`
          <table><thead><tr><th>Semana</th><th>Coletas</th>${inds.map(i=>`<th>${i.label}</th>`).join("")}<th>Prob.</th></tr></thead>
          <tbody>${rows2.map(r=>`<tr><td style="font-weight:600">S${r.s}</td><td>${r.total}</td>
            ${inds.map(i=>{const v=r[semFiltro?i.spKey:i.key];if(v==null)return'<td>—</td>';const cls=chipCls(v,i.meta,i.inv);const fmtv=i.inv?`${Math.round(v)}${i.unit}`:`${v.toFixed(1)}${i.unit}`;return`<td><span class="chip ${cls}">${fmtv}</span></td>`;}).join("")}
            <td style="font-weight:700;color:${(r.prob||0)>0?'#DC2626':'#16A34A'}">${r.prob||0}</td>
          </tr>`).join("")}</tbody></table>`}
        </div>`).join("")}
        <script>window.print();window.close();</script></body></html>`);
    }
  };

  const gerarParceiro = () => {
    const inds = INDICADORES_R.filter(i=>colsSel.includes(i.key));
    openPrint(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Parceiro</title><style>
      ${CSS_BASE}
      .parc-sec{padding:20px 28px;border-bottom:3px solid #FED7AA}
      .parc-sec:not(:first-child){page-break-before:always}
      .ptitle{font-size:20px;font-weight:800;color:#F97316;margin-bottom:4px}
      .psubtitle{font-size:11px;color:#6B7280;margin-bottom:16px}
      .header-bar{background:#F97316;color:white;padding:12px 28px;margin-bottom:0;display:flex;justify-content:space-between;align-items:center}
      .header-bar h1{font-size:18px;margin:0;font-weight:800}
      .header-bar span{font-size:12px;opacity:.85}
    </style></head><body>
      <div class="header-bar"><h1>📊 Relatório de Desempenho — Parça</h1><span>${new Date().toLocaleDateString("pt-BR")} · S${semSel.join(", S")}</span></div>
      ${parcSel.map(p=>{
        const rowsSem = semSel.map(s=>{const d=pdMerged[p]?.[s];return d?{s,...d}:null;}).filter(Boolean);
        const rowsMes = mesSel.map(m=>{
          if(!rawRows.length) return null;
          const rs=rawRows.filter(r=>r["Flag Situacao Coleta"]==="Coletado"&&r["Transportadora"]===p&&parseInt(r["Mês_Efetivada"])===m);
          if(rs.length<3) return null;
          const isNao=r=>norm_r(r["Vencido"])==="Nao";
          const isAg=r=>r["Agendamento"]==="1"||r["Agendamento"]===1;
          const agOk=rs.filter(isAg);
          const isAder=r=>{const v=r["Aderencia agendamento "]??r["Aderencia agendamento"];return v==="1"||v===1;};
          const ag=rs.map(r=>{const d=busdays_r(r["Data Solicitacao Date"],r["Data Coleta Efetivada Date"]);return d;}).filter(v=>v!=null);
          return {m,periodo:MESES_N[m],total:rs.length,
            sla:pct_r(rs.filter(isNao).length,rs.length),agend:pct_r(rs.filter(isAg).length,rs.length),
            ader:pct_r(agOk.filter(isAder).length,agOk.length),aging:ag.length?Math.round(ag.reduce((a,b)=>a+b,0)/ag.length*100)/100:null,
            prob:rs.filter(r=>r["Problema_de_coleta"]==="1"||r["Problema_de_coleta"]===1).length};
        }).filter(Boolean);
        const atr = inclAtrasos ? getAtrasos([p]) : [];
        const tblHeader = `<thead><tr><th>Período</th><th>Coletas</th>${inds.map(i=>`<th>${i.label}</th>`).join("")}<th>Prob.</th></tr></thead>`;
        const tblRow = r => `<tr><td style="font-weight:600">${r.periodo||`S${r.s}`}</td><td>${r.total}</td>${inds.map(i=>{const v=r[i.key];if(v==null)return'<td>—</td>';const cls=chipCls(v,i.meta,i.inv);const fv=i.inv?`${Math.round(v)}${i.unit}`:`${v.toFixed(1)}${i.unit}`;return`<td><span class="chip ${cls}">${fv}</span></td>`;}).join("")}<td style="font-weight:700;color:${(r.prob||0)>0?'#DC2626':'#16A34A'}">${r.prob||0}</td></tr>`;
        return `<div class="parc-sec">
          <div class="ptitle">${p}</div>
          <div class="section-title">📈 Por Semana</div>
          ${rowsSem.length?`<table>${tblHeader}<tbody>${rowsSem.map(tblRow).join("")}</tbody></table>`:'<p style="color:#6B7280;font-style:italic">Sem dados semanais.</p>'}
          <div class="section-title">📅 Por Mês</div>
          ${rowsMes.length?`<table>${tblHeader}<tbody>${rowsMes.map(tblRow).join("")}</tbody></table>`:'<p style="color:#6B7280;font-style:italic">Sem dados mensais.</p>'}
          ${inclAtrasos?`<div class="section-title">⏰ Atrasos (Vencido = Sim)</div>
          ${atr.length===0?'<p style="color:#16A34A;font-style:italic">✓ Nenhuma coleta em atraso.</p>':`
          <table><thead><tr><th>Pedido</th><th>Cidade</th><th>UF</th><th>Semana</th><th>Dias úteis</th><th>Classificação</th><th>Solicitação</th><th>Coleta</th></tr></thead>
          <tbody>${atr.map(r=>`<tr><td style="font-family:monospace;font-size:11px">${r["Pv"]||""}</td><td>${r["Cidade"]||""}</td><td>${r["Estado"]||""}</td><td>S${r["semana_Efetivada"]}</td><td style="font-weight:800">${r.diasAtraso}d</td><td><span class="chip ${faixaCls(r.diasAtraso)}">${faixaLbl(r.diasAtraso)}</span></td><td>${r["Data Solicitacao Date"]||""}</td><td>${r["Data Coleta Efetivada Date"]||""}</td></tr>`).join("")}</tbody>
          </table>`}`:''}
        </div>`;
      }).join("")}
      <script>window.print();window.close();</script></body></html>`);
  };

  const sec=(t)=><div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3,marginBottom:8,marginTop:14}}>{t}</div>;
  const parcChips=()=><>
    <div style={{display:"flex",gap:6,marginBottom:6}}>
      <button onClick={()=>setParcSel(parceirosDisp)} style={{fontSize:11,color:C.azul,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Todos</button>
      <button onClick={()=>setParcSel([])} style={{fontSize:11,color:C.cinzaTexto,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Nenhum</button>
    </div>
    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
      {parceirosDisp.map((p,i)=><button key={p} onClick={()=>setParcSel(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p])} style={sm2(parcSel.includes(p),PARC_CORES_R[i%PARC_CORES_R.length])}>{p.split(" ")[0]}</button>)}
    </div></>;
  const semChips=()=><>
    <div style={{display:"flex",gap:6,marginBottom:6}}>
      <button onClick={()=>setSemSel(todasSemanas)} style={{fontSize:11,color:C.azul,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Todas</button>
      <button onClick={()=>setSemSel([])} style={{fontSize:11,color:C.cinzaTexto,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Nenhuma</button>
    </div>
    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:14}}>
      {todasSemanas.map(s=><button key={s} onClick={()=>setSemSel(prev=>prev.includes(s)?prev.filter(x=>x!==s):[...prev,s])} style={sm2(semSel.includes(s))}>S{s}</button>)}
    </div></>;

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    {/* Seletor tipo */}
    <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:16}}>
      <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",marginBottom:10}}>Tipo de Relatório</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[["atrasos","⏰ Atrasos","Pedidos coletados fora do SLA"],
          ["painel","📊 Indicadores por Parceiro","SLA, Agendamento, Aderência, Aging por semana"],
          ["parceiro","🤝 Visão por Parceiro","Para apresentar ao parceiro — semana + mês + atrasos"]
        ].map(([k,l,d])=>(
          <button key={k} onClick={()=>setTipoRel(k)} style={{...pill2(tipoRel===k),borderRadius:10,padding:"8px 16px",textAlign:"left",display:"flex",flexDirection:"column",gap:2,minWidth:200}}>
            <span style={{fontWeight:700,fontSize:13}}>{l}</span>
            <span style={{fontSize:11,fontWeight:400,color:tipoRel===k?C.laranja:C.cinzaTexto}}>{d}</span>
          </button>
        ))}
      </div>
    </div>

    {/* Config Atrasos */}
    {tipoRel==="atrasos"&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:"16px 20px"}}>
      {sec("Parceiros")}{parcChips()}
      {sec("Semanas")}{semChips()}
      {sec("Faixas de aging")}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {[["5","≥ 5d",C.amarelo],["10","≥ 10d",C.laranja],["15","≥ 15d",C.roxo],["20","≥ 20d",C.vermelho],["25","≥ 25d","#7F1D1D"]].map(([v,l,c])=>(
          <button key={v} onClick={()=>setFaixaSel(prev=>prev.includes(v)?prev.filter(x=>x!==v):[...prev,v])} style={sm2(faixaSel.includes(v),c)}>{l}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>gerarAtrasos("csv")} style={{...pill2(true),display:"flex",alignItems:"center",gap:6}}>📥 Exportar CSV</button>
        <button onClick={()=>gerarAtrasos("pdf")} style={{...pill2(false,C.azul),color:C.azul,display:"flex",alignItems:"center",gap:6}}>🖨️ Imprimir / PDF</button>
      </div>
    </div>}

    {/* Config Painel */}
    {tipoRel==="painel"&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:"16px 20px"}}>
      {sec("Parceiros")}{parcChips()}
      {sec("Semanas")}{semChips()}
      {sec("Indicadores")}
      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:16}}>
        {INDICADORES_R.map(i=><button key={i.key} onClick={()=>setColsSel(prev=>prev.includes(i.key)?prev.filter(x=>x!==i.key):[...prev,i.key])} style={sm2(colsSel.includes(i.key))}>{i.label}</button>)}
      </div>
      <div style={{display:"flex",gap:10}}>
        <button onClick={()=>gerarPainel("csv")} style={{...pill2(true),display:"flex",alignItems:"center",gap:6}}>📥 Exportar CSV</button>
        <button onClick={()=>gerarPainel("pdf")} style={{...pill2(false,C.azul),color:C.azul,display:"flex",alignItems:"center",gap:6}}>🖨️ Imprimir / PDF</button>
      </div>
    </div>}

    {/* Config Parceiro */}
    {tipoRel==="parceiro"&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:"16px 20px"}}>
      {sec("Parceiros (um relatório por parceiro)")}{parcChips()}
      {sec("Semanas")}{semChips()}
      {sec("Meses")}
      <div style={{display:"flex",gap:6,marginBottom:6}}>
        <button onClick={()=>setMesSel(todosMeses)} style={{fontSize:11,color:C.azul,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Todos</button>
        <button onClick={()=>setMesSel([])} style={{fontSize:11,color:C.cinzaTexto,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Nenhum</button>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:14}}>
        {todosMeses.map(m=><button key={m} onClick={()=>setMesSel(prev=>prev.includes(m)?prev.filter(x=>x!==m):[...prev,m])} style={sm2(mesSel.includes(m))}>{MESES_N[m]}</button>)}
      </div>
      {sec("Indicadores")}
      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
        {INDICADORES_R.map(i=><button key={i.key} onClick={()=>setColsSel(prev=>prev.includes(i.key)?prev.filter(x=>x!==i.key):[...prev,i.key])} style={sm2(colsSel.includes(i.key))}>{i.label}</button>)}
      </div>
      {sec("Incluir")}
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:13,marginBottom:16}}>
        <input type="checkbox" checked={inclAtrasos} onChange={e=>setInclAtrasos(e.target.checked)} style={{accentColor:C.laranja}}/>
        Coletas em atraso (Vencido = Sim)
      </label>
      <button onClick={gerarParceiro} style={{background:C.azul,color:"white",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
        🖨️ Gerar PDF para apresentação
      </button>
      <div style={{fontSize:11,color:C.cinzaTexto,marginTop:8}}>Uma seção por parceiro · Abre janela de impressão do navegador</div>
    </div>}
  </div>;
};

// ══════════════════════════════════════════════════════════════════════════════
// Componente AbaCompararCSVs
// ══════════════════════════════════════════════════════════════════════════════
const AbaCompararCSVs = ({parseCSVFn, busdays_r, norm_r, PARC_CORES_R}) => {
  const [csv1Rows, setCsv1Rows] = useState([]);
  const [csv2Rows, setCsv2Rows] = useState([]);
  const [csv1Nome, setCsv1Nome] = useState("");
  const [csv2Nome, setCsv2Nome] = useState("");
  const [loading,  setLoading]  = useState("");

  const carregarCSV = (file, setCsv, setNome) => {
    setLoading(file.name);
    const reader = new FileReader();
    reader.onload = ev => { setCsv(parseCSVFn(ev.target.result)); setNome(file.name); setLoading(""); };
    reader.readAsText(file);
  };

  const diff = useMemo(() => {
    if(!csv1Rows.length || !csv2Rows.length) return null;
    const col1 = new Map(csv1Rows.filter(r=>r["Flag Situacao Coleta"]==="Coletado"&&r["Pv"]).map(r=>[r["Pv"],r]));
    const col2 = csv2Rows.filter(r=>r["Flag Situacao Coleta"]==="Coletado"&&r["Pv"]);
    const novos = col2.filter(r=>!col1.has(r["Pv"])).map(r=>({...r,diasAging:busdays_r(r["Data Solicitacao Date"],r["Data Coleta Efetivada Date"])}));
    const crossMap = {};
    novos.forEach(r=>{
      const sol=parseInt(r["semana_solicitação"]),efe=parseInt(r["semana_Efetivada"]);
      if(isNaN(sol)||isNaN(efe)||sol===efe) return; // ignorar mesma semana
      const key=`S${sol}→S${efe}`;
      if(!crossMap[key]) crossMap[key]={sol,efe,rows:[]};
      crossMap[key].rows.push(r);
    });
    const porParceiro={};
    novos.forEach(r=>{const p=r["Transportadora"]||"—";if(!porParceiro[p])porParceiro[p]={total:0,vencido:0};porParceiro[p].total++;if(norm_r(r["Vencido"])==="Sim")porParceiro[p].vencido++;});
    return {novos, crossMap, porParceiro, totalCSV1:col1.size, totalCSV2:col2.length};
  },[csv1Rows,csv2Rows]);

  const pill2=(on,cor=C.laranja)=>({padding:"4px 12px",borderRadius:999,border:`1.5px solid ${on?cor:C.cinzaBorda}`,background:on?`${cor}18`:"transparent",cursor:"pointer",fontSize:12,fontWeight:600,color:on?cor:C.cinzaTexto});
  const sm2=(on,cor=C.laranja)=>({...pill2(on,cor),padding:"3px 8px",fontSize:11});
  const escCSV=v=>{const s=String(v??"");return s.includes(";")||s.includes('"')?`"${s.replace(/"/g,'""')}"`:s;};
  const dlCSV=(rows2,nome)=>{const csv=rows2.map(r=>r.map(escCSV).join(";")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));a.download=`${nome}_${new Date().toISOString().slice(0,10)}.csv`;a.click();};
  const faixaCor=d=>d>=25?"#7F1D1D":d>=20?C.vermelho:d>=15?C.roxo:d>=10?C.laranja:d>=5?C.amarelo:C.verde;
  const faixaBg =d=>d>=25?"#FEE2E2":d>=20?C.vermelhoLight:d>=15?C.roxoLight:d>=10?"#FFF7ED":d>=5?C.amareloLight:C.verdeLight;

  // Filtro de semana de efetivação
  const [crossSemSel, setCrossSemSel] = useState([]);
  const semsEfet = useMemo(()=>diff?[...new Set(diff.novos.map(r=>parseInt(r["semana_Efetivada"])).filter(n=>!isNaN(n)))].sort((a,b)=>a-b):[],[diff]);
  useEffect(()=>{ if(semsEfet.length>0) setCrossSemSel(semsEfet); },[semsEfet.join(",")]);

  // Filtro de parceiro para a tabela de cross semanas
  const [crossParcSel, setCrossParcSel] = useState([]);
  const parcsNovos = useMemo(()=>diff?[...new Set(diff.novos.map(r=>r["Transportadora"]).filter(Boolean))].sort():[],[diff]);
  useEffect(()=>{ if(parcsNovos.length>0) setCrossParcSel(parcsNovos); },[parcsNovos.join(",")]);

  const crossMapFiltrado = useMemo(()=>{
    if(!diff) return {};
    const novFilt = diff.novos.filter(r=>
      (crossParcSel.length===0||crossParcSel.includes(r["Transportadora"])) &&
      (crossSemSel.length===0||crossSemSel.includes(parseInt(r["semana_Efetivada"])))
    );
    const map = {};
    novFilt.forEach(r=>{
      const sol=parseInt(r["semana_solicitação"]),efe=parseInt(r["semana_Efetivada"]);
      if(isNaN(sol)||isNaN(efe)||sol===efe) return; // ignorar mesma semana
      const key=`S${sol}→S${efe}`;
      if(!map[key]) map[key]={sol,efe,rows:[]};
      map[key].rows.push(r);
    });
    return map;
  },[diff, crossParcSel]);

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    {/* Upload */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      {[["📁 CSV Anterior",csv1Nome,csv1Rows,f=>carregarCSV(f,setCsv1Rows,setCsv1Nome)],
        ["📁 CSV Novo",csv2Nome,csv2Rows,f=>carregarCSV(f,setCsv2Rows,setCsv2Nome)]
      ].map(([titulo,nome,rows,fn],i)=>(
        <div key={i} style={{background:C.cinzaCard,border:`2px dashed ${nome?C.verde:C.cinzaBorda}`,borderRadius:12,padding:20,textAlign:"center"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.cinzaTexto,marginBottom:12}}>{titulo}</div>
          {nome?<div>
            <div style={{fontSize:18,marginBottom:4}}>✅</div>
            <div style={{fontWeight:700,fontSize:13,color:C.verde,marginBottom:4}}>{nome}</div>
            <div style={{fontSize:11,color:C.cinzaTexto,marginBottom:8}}>{rows.filter(r=>r["Flag Situacao Coleta"]==="Coletado").length} coletas</div>
            <label style={{...pill2(false),cursor:"pointer",fontSize:11}}>
              <input type="file" accept=".csv" style={{display:"none"}} onChange={e=>{if(e.target.files[0])fn(e.target.files[0]);e.target.value="";}}/>Trocar
            </label>
          </div>:<label style={{cursor:"pointer"}}>
            <input type="file" accept=".csv" style={{display:"none"}} onChange={e=>{if(e.target.files[0])fn(e.target.files[0]);e.target.value="";}}/>
            <div style={{fontSize:28,marginBottom:6}}>📂</div>
            <div style={{fontSize:12,color:C.cinzaTexto}}>Clique para carregar</div>
          </label>}
        </div>
      ))}
    </div>

    {loading&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:16,textAlign:"center",color:C.cinzaTexto}}>⏳ Processando {loading}...</div>}

    {!diff&&!loading&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:32,textAlign:"center",color:C.cinzaTexto}}>
      <div style={{fontSize:28,marginBottom:8}}>🔄</div>
      <div style={{fontWeight:700,fontSize:15,color:C.texto,marginBottom:6}}>Comparar dois CSVs</div>
      <div style={{fontSize:13}}>Carregue o CSV anterior e o novo. O dashboard mostra os pedidos que apareceram como coletados no novo arquivo mas não estavam no anterior.</div>
    </div>}

    {diff&&<>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
        {[{l:"Coletados no anterior",v:diff.totalCSV1,c:C.cinzaTexto},{l:"Coletados no novo",v:diff.totalCSV2,c:C.azul},{l:"Novos coletados",v:diff.novos.length,c:C.verde},{l:"Novos fora do SLA",v:diff.novos.filter(r=>norm_r(r["Vencido"])==="Sim").length,c:C.vermelho}].map(({l,v,c},i)=>(
          <div key={i} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:"14px 18px",borderLeft:`4px solid ${c}`}}>
            <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",marginBottom:4}}>{l}</div>
            <div style={{fontSize:28,fontWeight:800,color:c,lineHeight:1}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Cross semana */}
      <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
        <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>
            🔄 De qual semana vieram os novos coletados?
            <span style={{fontSize:11,color:C.cinzaTexto,fontWeight:400,marginLeft:8}}>Semana de solicitação → semana de efetivação</span>
          </div>
          {/* Filtro semana efetivação */}
          <div style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3}}>Semana de efetivação</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setCrossSemSel(semsEfet)} style={{fontSize:11,color:C.azul,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Todas</button>
                <button onClick={()=>setCrossSemSel([])} style={{fontSize:11,color:C.cinzaTexto,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Nenhuma</button>
              </div>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {semsEfet.map(s=><button key={s} onClick={()=>setCrossSemSel(prev=>prev.includes(s)?prev.filter(x=>x!==s):[...prev,s])} style={sm2(crossSemSel.includes(s))}>S{s}</button>)}
            </div>
          </div>
          {/* Filtro parceiro */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3}}>Filtrar por parceiro</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setCrossParcSel(parcsNovos)} style={{fontSize:11,color:C.azul,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Todos</button>
              <button onClick={()=>setCrossParcSel([])} style={{fontSize:11,color:C.cinzaTexto,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Nenhum</button>
            </div>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {parcsNovos.map((p,i)=><button key={p} onClick={()=>setCrossParcSel(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p])} style={sm2(crossParcSel.includes(p),PARC_CORES_R[i%PARC_CORES_R.length])}>{p.split(" ")[0]}</button>)}
          </div>
        </div>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{background:C.cinzaFundo}}>{["Solicitado em","Efetivado em","Coletas","Fora do SLA","SLA %"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:h==="Coletas"||h.includes("SLA")||h.includes("Fora")?"center":"left",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
          <tbody>{Object.values(crossMapFiltrado).sort((a,b)=>a.sol!==b.sol?a.sol-b.sol:a.efe-b.efe).map(({sol,efe,rows},i)=>{
            const venc=rows.filter(r=>norm_r(r["Vencido"])==="Sim").length;
            const sla=Math.round((1-venc/rows.length)*100);
            const cor=sla>=86?C.verde:sla>=80?C.amarelo:C.vermelho;
            const bg=sla>=86?C.verdeLight:sla>=80?C.amareloLight:C.vermelhoLight;
            return <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
              <td style={{padding:"8px 12px",fontWeight:700}}>S{sol}</td>
              <td style={{padding:"8px 12px",color:C.azul,fontWeight:700}}>S{efe}</td>
              <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700}}>{rows.length}</td>
              <td style={{padding:"8px 12px",textAlign:"center",color:venc>0?C.vermelho:C.cinzaTexto,fontWeight:venc>0?700:400}}>{venc}</td>
              <td style={{padding:"8px 12px",textAlign:"center"}}><span style={{fontWeight:700,color:cor,background:bg,padding:"2px 8px",borderRadius:6}}>{sla}%</span></td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>

      {/* Por parceiro */}
      <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
        <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13}}>Por Parceiro — Novos Coletados</div>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{background:C.cinzaFundo}}>{["Parceiro","Novos","Fora do SLA","SLA %"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:h==="Parceiro"?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>{Object.entries(diff.porParceiro).sort((a,b)=>b[1].total-a[1].total).map(([p,v],i)=>{
            const sla=Math.round((1-v.vencido/v.total)*100);
            const cor=sla>=86?C.verde:sla>=80?C.amarelo:C.vermelho;
            const bg=sla>=86?C.verdeLight:sla>=80?C.amareloLight:C.vermelhoLight;
            return <tr key={p} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
              <td style={{padding:"8px 12px",fontWeight:600,color:PARC_CORES_R[i%PARC_CORES_R.length]}}>{p}</td>
              <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700}}>{v.total}</td>
              <td style={{padding:"8px 12px",textAlign:"center",color:v.vencido>0?C.vermelho:C.cinzaTexto,fontWeight:v.vencido>0?700:400}}>{v.vencido}</td>
              <td style={{padding:"8px 12px",textAlign:"center"}}><span style={{fontWeight:700,color:cor,background:bg,padding:"2px 8px",borderRadius:6}}>{sla}%</span></td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>

      {/* Detalhe pedidos */}
      <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
        <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontWeight:700,fontSize:13}}>Pedidos Novos — Detalhe ({diff.novos.length})</span>
          <button onClick={()=>dlCSV([["Pedido","Parceiro","Cidade","UF","Sem. Sol.","Sem. Efet.","Aging (d.u.)","SLA","Data Solicitação","Data Coleta"],...diff.novos.map(r=>[r["Pv"]||"",r["Transportadora"]||"",r["Cidade"]||"",r["Estado"]||"",`S${r["semana_solicitação"]}`,`S${r["semana_Efetivada"]}`,r.diasAging??"",norm_r(r["Vencido"])==="Sim"?"Vencido":"OK",r["Data Solicitacao Date"]||"",r["Data Coleta Efetivada Date"]||""])],"novos_coletados")} style={{...pill2(false,C.azul),color:C.azul,fontSize:11}}>📥 CSV</button>
        </div>
        <div style={{overflowX:"auto",maxHeight:440,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead style={{position:"sticky",top:0,zIndex:1}}><tr style={{background:C.cinzaFundo}}>
              {["Pedido","Parceiro","Cidade","UF","Sol.","Efet.","Aging","SLA","Solicitação","Coleta"].map(h=><th key={h} style={{padding:"7px 12px",textAlign:["Aging"].includes(h)?"center":"left",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            <tbody>{[...diff.novos].sort((a,b)=>(b.diasAging??0)-(a.diasAging??0)).map((r,i)=>{
              const dias=r.diasAging??0; const venc=norm_r(r["Vencido"])==="Sim";
              return <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
                <td style={{padding:"6px 12px",fontWeight:600,fontFamily:"monospace",fontSize:11}}>{r["Pv"]||"—"}</td>
                <td style={{padding:"6px 12px",fontSize:11}}>{(r["Transportadora"]||"").split(" ")[0]}</td>
                <td style={{padding:"6px 12px",color:C.cinzaTexto,fontSize:11}}>{r["Cidade"]||"—"}</td>
                <td style={{padding:"6px 12px",color:C.cinzaTexto,fontSize:11}}>{r["Estado"]||"—"}</td>
                <td style={{padding:"6px 12px",fontSize:11,fontWeight:600}}>S{r["semana_solicitação"]}</td>
                <td style={{padding:"6px 12px",fontSize:11,color:C.azul,fontWeight:600}}>S{r["semana_Efetivada"]}</td>
                <td style={{padding:"6px 12px",textAlign:"center"}}>{dias>0?<span style={{fontWeight:700,color:faixaCor(dias),background:faixaBg(dias),padding:"1px 7px",borderRadius:5,fontSize:11}}>{dias}d</span>:<span style={{color:C.cinzaTexto}}>—</span>}</td>
                <td style={{padding:"6px 12px",fontSize:11}}>{venc?<span style={{background:C.vermelhoLight,color:C.vermelho,padding:"1px 7px",borderRadius:4,fontWeight:700,fontSize:10}}>Vencido</span>:<span style={{background:C.verdeLight,color:C.verde,padding:"1px 7px",borderRadius:4,fontWeight:700,fontSize:10}}>OK</span>}</td>
                <td style={{padding:"6px 12px",color:C.cinzaTexto,fontSize:11}}>{r["Data Solicitacao Date"]||"—"}</td>
                <td style={{padding:"6px 12px",color:C.cinzaTexto,fontSize:11}}>{r["Data Coleta Efetivada Date"]||"—"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>
    </>}
  </div>;
};

export default function App() {

  // ── State ──────────────────────────────────────────────────────────────────
  const [rawRows,        setRawRows]        = useState([]);
  const [weeklyExtra,    setWeeklyExtra]    = useState(()=>{ try{const s=localStorage.getItem("slaParca_weekly");return s?JSON.parse(s):[];}catch{return [];} });
  const [pdExtra,        setPdExtra]        = useState(()=>{ try{const s=localStorage.getItem("slaParca_pd");    return s?JSON.parse(s):{};}catch{return {};} });
  const [uploadHistory,  setUploadHistory]  = useState(()=>{ try{const s=localStorage.getItem("slaParca_hist"); return s?JSON.parse(s):[];}catch{return [];} });
  const [variacaoVol,    setVariacaoVol]    = useState(()=>{ try{const s=localStorage.getItem("slaParca_var");  return s?JSON.parse(s):[];}catch{return [];} });

  const [csvStatus,   setCsvStatus]   = useState("idle"); // idle | processando | ok | erro
  const [csvNome,     setCsvNome]     = useState("");
  const [csvResumo,   setCsvResumo]   = useState({novas:[],retroativas:[],variacoes:[]});

  const [abaGlobal,   setAbaGlobal]   = useState("geral");
  const [abaSub,      setAbaSub]      = useState("painel");
  const [granular,    setGranular]    = useState("semana");
  const [modo,        setModo]        = useState("individual");
  const [semFiltro,   setSemFiltro]   = useState(false);

  const [semanasSel,     setSemanasSel]     = useState([]);
  const [mesesSel,       setMesesSel]       = useState([]);
  const [trimestresSel,  setTrimestresSel]  = useState([]);
  const [indicSel,       setIndicSel]       = useState(INDICADORES.map(i=>i.key));
  const [parceiros,      setParceiros]      = useState([]);
  const [compA,          setCompA]          = useState(null);
  const [compB,          setCompB]          = useState(null);
  const [simAumentoVendas, setSimAumentoVendas] = useState(79);
  const [simSLAEsperado,   setSimSLAEsperado]   = useState(84);

  // ── WEEKLY e PD merged ─────────────────────────────────────────────────────
  const WEEKLY_MERGED = useMemo(()=>{
    const extraSet = new Set(weeklyExtra.map(w=>w.s));
    // sem hardcoded — tudo vem do CSV/localStorage
    return [...weeklyExtra].sort((a,b)=>a.s-b.s);
  },[weeklyExtra]);

  const PD_MERGED = useMemo(()=>({...pdExtra}),[pdExtra]);

  const ALL_SEMANAS = useMemo(()=>WEEKLY_MERGED.map(w=>w.s),[WEEKLY_MERGED]);

  const monthlyData = useMemo(()=>{
    if(!rawRows.length) return [];
    const map={};
    rawRows.filter(r=>r["Flag Situacao Coleta"]==="Coletado").forEach(r=>{
      const m=parseInt(r["Mês_Efetivada"]); if(!m||m<1||m>12) return;
      if(!map[m]) map[m]={m,rows:[]};
      map[m].rows.push(r);
    });
    return Object.values(map).map(({m,rows})=>{
      const d=calcSemana(rows); return d?{m,...d}:null;
    }).filter(Boolean).sort((a,b)=>a.m-b.m);
  },[rawRows]);

  const ALL_MESES = useMemo(()=>monthlyData.map(d=>d.m),[monthlyData]);

  // ── PARCEIROS dinâmico ─────────────────────────────────────────────────────
  const PARCEIROS = useMemo(()=>{
    const doPD  = Object.keys(PD_MERGED);
    const doCSV = rawRows.length>0
      ? [...new Set(rawRows.filter(r=>r["Transportadora"]).map(r=>r["Transportadora"]).filter(Boolean))]
      : [];
    return [...new Set([...doPD,...doCSV])].sort();
  },[PD_MERGED,rawRows]);

  // Auto-selecionar todos ao carregar
  useEffect(()=>{
    if(PARCEIROS.length>0 && parceiros.length===0) setParceiros(PARCEIROS);
  },[PARCEIROS.join(",")]);

  // ── sel / lbl ──────────────────────────────────────────────────────────────
  const sel = granular==="semana"?semanasSel:granular==="mes"?mesesSel:granular==="trim"?trimestresSel:["2026"];
  const lbl = p => granular==="semana"?`S${p}`:granular==="mes"?MESES_NOME[p]:granular==="trim"?`T${p}`:p;

  // ── filtrarPorPeriodo ──────────────────────────────────────────────────────
  const filtrarPorPeriodo = useCallback((rows)=>{
    if(granular==="semana") return rows.filter(r=>semanasSel.includes(parseInt(r["semana_Efetivada"])));
    if(granular==="mes")    return rows.filter(r=>mesesSel.includes(parseInt(r["Mês_Efetivada"])));
    if(granular==="trim")   return rows.filter(r=>{
      const m=parseInt(r["Mês_Efetivada"]);
      return trimestresSel.some(t=>TRIM_MESES[t]?.includes(m));
    });
    return rows.filter(r=>String(r["Ano_Efetivada"]).trim()==="2026");
  },[granular,semanasSel,mesesSel,trimestresSel]);

  // ── getRaw ─────────────────────────────────────────────────────────────────
  const getRaw = useCallback((p,periodo)=>{
    if(granular==="semana") return PD_MERGED[p]?.[periodo];
    if(granular==="mes"){
      const d=monthlyData.find(m=>m.m===periodo);
      if(!d) return null;
      // Filtrar por parceiro
      if(!rawRows.length) return null;
      const rows=rawRows.filter(r=>r["Transportadora"]===p&&parseInt(r["Mês_Efetivada"])===periodo&&r["Flag Situacao Coleta"]==="Coletado");
      return rows.length>=3?calcSemana(rows):null;
    }
    if(granular==="trim"){
      const meses=TRIM_MESES[periodo]||[];
      const results=meses.map(m=>getRaw(p,m)).filter(Boolean);
      if(!results.length) return null;
      const total=results.reduce((a,r)=>a+r.total,0);
      const getW=key=>{let s=0,t=0;results.forEach(r=>{if(r[key]!=null){s+=r[key]*r.total;t+=r.total;}});return t?Math.round(s/t*100)/100:null;};
      const obj={total};INDICADORES.forEach(i=>{obj[i.key]=getW(i.key);obj[i.spKey]=getW(i.spKey);});
      obj.prob=results.reduce((a,r)=>a+(r.prob||0),0);
      return obj;
    }
    return null;
  },[granular,PD_MERGED,monthlyData,rawRows]);

  // ── snapGeral ──────────────────────────────────────────────────────────────
  const snapGeral = useMemo(()=>{
    let rows = [];
    if(granular==="semana"){
      rows = sel.map(p=>WEEKLY_MERGED.find(w=>w.s===p)).filter(Boolean);
    } else if(granular==="mes"){
      rows = sel.map(m=>monthlyData.find(d=>d.m===m)).filter(Boolean);
    } else if(granular==="trim"){
      rows = sel.flatMap(t=>(TRIM_MESES[t]||[]).map(m=>monthlyData.find(d=>d.m===m)).filter(Boolean));
    } else {
      // ano — todos os meses disponíveis
      rows = monthlyData;
    }
    if(!rows.length) return {};
    const total=rows.reduce((a,r)=>a+r.total,0);
    const getW=key=>{let s=0,t=0;rows.forEach(r=>{if(r[key]!=null){s+=r[key]*r.total;t+=r.total;}});return t?Math.round(s/t*100)/100:null;};
    const obj={total};
    INDICADORES.forEach(i=>{obj[i.key]=getW(semFiltro?i.spKey:i.key);});
    return obj;
  },[granular,sel,WEEKLY_MERGED,monthlyData,semFiltro]);

  // ── snapParceiros ──────────────────────────────────────────────────────────
  const snapParceiros = useMemo(()=>parceiros.map(p=>{
    const rows=sel.map(per=>getRaw(p,per)).filter(Boolean);
    if(!rows.length) return {nome:p,total:0,...Object.fromEntries(INDICADORES.map(i=>[i.key,null])),prob:0};
    const total=rows.reduce((a,r)=>a+r.total,0);
    const getW=key=>{let s=0,t=0;rows.forEach(r=>{if(r[key]!=null){s+=r[key]*r.total;t+=r.total;}});return t?Math.round(s/t*100)/100:null;};
    const obj={nome:p,total,prob:rows.reduce((a,r)=>a+(r.prob||0),0)};
    INDICADORES.forEach(i=>{obj[i.key]=getW(semFiltro?i.spKey:i.key);});
    return obj;
  }),[parceiros,sel,getRaw,semFiltro]);

  // ── variacaoParceiros ─────────────────────────────────────────────────────
  const variacaoParceiros = useMemo(()=>{
    let periodos=[];
    if(granular==="semana") periodos=ALL_SEMANAS.slice(-2);
    else if(granular==="mes") periodos=ALL_MESES.slice(-2);
    if(periodos.length<2) return [];
    const [pAnt,pAtual]=periodos;
    return parceiros.map(p=>{
      const dAnt=getRaw(p,pAnt), dAtual=getRaw(p,pAtual);
      if(!dAnt||!dAtual) return null;
      const inds=INDICADORES.map(ind=>{
        const vAnt=dAnt[semFiltro?ind.spKey:ind.key], vAtual=dAtual[semFiltro?ind.spKey:ind.key];
        if(vAnt==null||vAtual==null) return null;
        const delta=Math.round((vAtual-vAnt)*100)/100;
        return {...ind,vAnt,vAtual,delta,piourou:ind.inv?delta>0.5:delta<-0.5,abaixoMeta:ind.inv?vAtual>ind.meta:vAtual<ind.meta};
      }).filter(Boolean);
      return {parceiro:p,pAnt,pAtual,labelAnt:lbl(pAnt),labelAtual:lbl(pAtual),inds,temPiora:inds.some(i=>i.piourou)};
    }).filter(Boolean);
  },[parceiros,granular,ALL_SEMANAS,ALL_MESES,getRaw,semFiltro,lbl]);

  // ── CSV Processing ─────────────────────────────────────────────────────────
  const handleCSV = (file) => {
    setCsvStatus("processando"); setCsvNome(file.name);
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const rows=parseCSV(ev.target.result);
        setRawRows(rows);

        // Semanas válidas do CSV
        const coletado=rows.filter(r=>r["Flag Situacao Coleta"]==="Coletado");
        const semanasRaw=[...new Set(coletado.map(r=>parseInt(r["semana_Efetivada"])).filter(n=>!isNaN(n)&&n>=1&&n<=53))].sort((a,b)=>a-b);
        const semanasProc=semanasRaw.slice(0,-1); // ignorar última (em aberto)

        if(!semanasProc.length){ setCsvStatus("ok"); return; }

        // Parceiros do CSV (local, não do state)
        const parcsCSV=[...new Set(coletado.map(r=>r["Transportadora"]).filter(Boolean))].sort();

        // Calcular todas as semanas
        const novasW=[], retroativasW=[];
        setWeeklyExtra(prev=>{
          const newW=[], retW=[];
          semanasProc.forEach(s=>{
            const rowsS=coletado.filter(r=>parseInt(r["semana_Efetivada"])===s);
            const d=calcSemana(rowsS); if(!d) return;
            const obj={s,...d};
            if(prev.some(w=>w.s===s)) retW.push(obj); else newW.push(obj);
          });
          novasW.push(...newW); retroativasW.push(...retW);
          const calculadas=[...newW,...retW];
          // Manter semanas que NÃO estão neste CSV (não sobrescrever)
          const merged=[
            ...prev.filter(w=>!calculadas.find(n=>n.s===w.s)), // semanas antigas não tocadas
            ...calculadas                                         // semanas do CSV atualizadas
          ].sort((a,b)=>a.s-b.s);
          try{localStorage.setItem("slaParca_weekly",JSON.stringify(merged));}catch{}
          return merged;
        });

        // Por parceiro — capturar snapshot anterior para calcular variações
        let pdSnapshot = {};
        setPdExtra(prev=>{
          pdSnapshot = prev; // snapshot ANTES de atualizar
          const merged={...prev};
          parcsCSV.forEach(p=>{
            const rowsP=coletado.filter(r=>r["Transportadora"]===p);
            semanasProc.forEach(s=>{
              const rowsPS=rowsP.filter(r=>parseInt(r["semana_Efetivada"])===s);
              if(rowsPS.length<3) return;
              const d=calcSemana(rowsPS); if(!d) return;
              if(!merged[p]) merged[p]={};
              merged[p][s]=d;
            });
          });
          try{localStorage.setItem("slaParca_pd",JSON.stringify(merged));}catch{}
          return merged;
        });

        // Calcular variações de volume nas semanas retroativas
        const variacoes = retroativasW.map(w=>{
          // Total anterior (do weeklyExtra snapshot — capturado dentro do setWeeklyExtra)
          const semAnt = weeklyExtra.find(e=>e.s===w.s);
          const totalAnt = semAnt?.total ?? null;
          const totalNovo = w.total;
          if(totalAnt===null||totalAnt===totalNovo) return null;

          // Por parceiro
          const porParceiro = parcsCSV.map(p=>{
            const antes  = pdSnapshot[p]?.[w.s]?.total ?? null;
            const depois = coletado.filter(r=>r["Transportadora"]===p&&parseInt(r["semana_Efetivada"])===w.s).length;
            if(antes===null||antes===depois) return null;
            return {parceiro:p, antes, depois, diff:depois-antes};
          }).filter(Boolean);

          return {semana:w.s, totalAnt, totalNovo, diff:totalNovo-totalAnt, porParceiro};
        }).filter(Boolean);

        if(variacoes.length>0){
          setVariacaoVol(prev=>{
            const entry={
              data:new Date().toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}),
              arquivo:file.name,
              variacoes,
            };
            const updated=[...prev,entry];
            try{localStorage.setItem("slaParca_var",JSON.stringify(updated));}catch{}
            return updated;
          });
        }

        // Upload history
        setUploadHistory(prev=>{
          const entry={nome:file.name,data:new Date().toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}),total:rows.length};
          const updated=[...prev,entry];
          try{localStorage.setItem("slaParca_hist",JSON.stringify(updated));}catch{}
          return updated;
        });

        // Auto-selecionar última semana
        const ultimaSem=semanasProc[semanasProc.length-1];
        setSemanasSel([ultimaSem]);
        setParceiros(parcsCSV);

        setCsvStatus("ok");
        setCsvResumo({novas:novasW.map(w=>w.s),retroativas:retroativasW.map(w=>w.s),variacoes});
      }catch(e){console.error(e);setCsvStatus("erro");}
    };
    reader.readAsText(file);
  };

  // ── Exportar CSV ───────────────────────────────────────────────────────────
  const escCSV=v=>{const s=String(v??"");return s.includes(";")||s.includes('"')?`"${s.replace(/"/g,'""')}"`:s;};
  const downloadCSV=(rows,nome)=>{
    const csv=rows.map(r=>r.map(escCSV).join(";")).join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));
    a.download=`${nome}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const exportarPainel=()=>{
    if(!snapParceiros.length){alert("Sem dados.");return;}
    const inds=INDICADORES.filter(i=>indicSel.includes(i.key));
    downloadCSV([
      ["Parceiro","Período","Coletas",...inds.map(i=>i.label),"Prob."],
      ...snapParceiros.map(row=>[row.nome,sel.map(p=>lbl(p)).join("+"),row.total,...inds.map(i=>{const v=row[i.key];return v!=null?v.toFixed(2)+i.unit:"—";}),row.prob])
    ],"painel_desempenho");
  };

  const exportarCSV=()=>{
    if(abaGlobal==="geral"){
      downloadCSV([["Período","Coletas",...INDICADORES.filter(i=>indicSel.includes(i.key)).map(i=>i.label)],
        ...WEEKLY_MERGED.map(w=>[`S${w.s}`,w.total,...INDICADORES.filter(i=>indicSel.includes(i.key)).map(i=>w[i.key]!=null?w[i.key].toFixed(2)+i.unit:"—")])
      ],"visao_geral");
    } else if(abaGlobal==="parceiros") {
      exportarPainel();
    }
  };

  // ── Botões helpers ─────────────────────────────────────────────────────────
  const pill=(on,cor=C.laranja)=>({padding:"5px 14px",borderRadius:999,border:`1.5px solid ${on?cor:C.cinzaBorda}`,background:on?`${cor}18`:"transparent",cursor:"pointer",fontSize:13,fontWeight:600,color:on?cor:C.cinzaTexto});
  const sm=(on,cor=C.laranja)=>({...pill(on,cor),padding:"3px 10px",fontSize:11});
  const hdr=(label,active)=>({padding:"8px 16px",borderRadius:8,border:"none",background:active?C.laranja:"transparent",color:active?"white":C.cinzaTexto,cursor:"pointer",fontWeight:active?700:500,fontSize:13,display:"flex",alignItems:"center",gap:6});

  // ── Render ─────────────────────────────────────────────────────────────────
  return <div style={{minHeight:"100vh",background:C.cinzaFundo,fontFamily:"'Inter',system-ui,sans-serif"}}>

    {/* ── HEADER ── */}
    <div style={{background:"white",borderBottom:`1px solid ${C.cinzaBorda}`,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",position:"sticky",top:0,zIndex:10}}>
      <div style={{fontWeight:800,fontSize:16,color:C.laranja,marginRight:8}}>🏠 Parça</div>
      {ALL_SEMANAS.length>0&&<span style={{fontSize:11,color:C.cinzaTexto}}>S{ALL_SEMANAS[ALL_SEMANAS.length-1]}</span>}

      {/* Status CSV */}
      {csvStatus==="processando"&&<span style={{fontSize:11,color:C.cinzaTexto}}>⏳ processando...</span>}
      {csvStatus==="ok"&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:11,background:C.verdeLight,color:C.verde,padding:"2px 10px",borderRadius:999,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          ✓ {csvNome}
          {csvResumo.novas.length>0&&<span>· +{csvResumo.novas.length} nova{csvResumo.novas.length>1?"s":""} (S{csvResumo.novas.join(", S")})</span>}
          {csvResumo.retroativas.length>0&&<span style={{color:C.azul}}>· {csvResumo.retroativas.length} retroativa{csvResumo.retroativas.length>1?"s":""} (S{csvResumo.retroativas.join(", S")})</span>}
        </span>
        {csvResumo.variacoes&&csvResumo.variacoes.length>0&&(
          <div style={{position:"relative",display:"inline-block"}}>
            <span style={{
              fontSize:11,background:"#FFF7ED",color:C.laranja,padding:"4px 12px",
              borderRadius:999,border:`1px solid ${C.laranjaLight}`,cursor:"pointer",
              fontWeight:700,display:"flex",alignItems:"center",gap:5
            }}
              title="Clique para ver detalhes"
              onClick={()=>setAbaGlobal("config")}
            >
              📊 {csvResumo.variacoes.reduce((a,v)=>a+Math.abs(v.diff),0)>0
                ? `${csvResumo.variacoes.reduce((a,v)=>a+(v.diff>0?v.diff:0),0)>0?"+":""}${csvResumo.variacoes.reduce((a,v)=>a+v.diff,0)} coletas em ${csvResumo.variacoes.length} sem.`
                : "variação detectada"
              }
              {csvResumo.variacoes.some(v=>v.porParceiro?.length>0)&&
                <span style={{fontSize:10,color:C.cinzaTexto,fontWeight:400}}>
                  ({csvResumo.variacoes.flatMap(v=>v.porParceiro||[]).length} parceiro{csvResumo.variacoes.flatMap(v=>v.porParceiro||[]).length>1?"s":""})
                </span>
              }
            </span>
          </div>
        )}
      </div>}
      {csvStatus==="erro"&&<span style={{fontSize:11,background:C.vermelhoLight,color:C.vermelho,padding:"2px 10px",borderRadius:999}}>❌ Erro ao processar CSV</span>}

      <div style={{flex:1}}/>

      {/* Botões */}
      <label style={{...pill(false),cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
        <input type="file" accept=".csv" style={{display:"none"}} onChange={e=>{if(e.target.files[0])handleCSV(e.target.files[0]);e.target.value="";}}/>
        📂 Carregar CSV
      </label>
      {(abaGlobal==="geral"||abaGlobal==="parceiros")&&<button onClick={exportarCSV} style={{...pill(false),display:"flex",alignItems:"center",gap:5,color:C.azul}}>📥 Exportar CSV</button>}
    </div>

    {/* ── ABAS PRINCIPAIS ── */}
    <div style={{background:"white",borderBottom:`1px solid ${C.cinzaBorda}`,padding:"0 24px",display:"flex",gap:4,overflowX:"auto"}}>
      {[["geral","🏠 Visão Geral"],["parceiros","🔍 Por Parceiro"],["atrasos","⏰ Atrasos"],["problemas_tab","⚠️ Problemas"],["relatorios","📋 Relatórios"],["comparar","🔄 Comparar CSVs"],["simulacao","📈 Simulação"],["config","⚙️ Configurações"]].map(([k,l])=>(
        <button key={k} onClick={()=>setAbaGlobal(k)} style={{...hdr(l,abaGlobal===k),borderRadius:0,borderBottom:abaGlobal===k?`2px solid ${C.laranja}`:"2px solid transparent",padding:"12px 16px"}}>{l}</button>
      ))}
    </div>

    <div style={{maxWidth:1280,margin:"0 auto",padding:"20px 24px",display:"flex",flexDirection:"column",gap:16}}>

      {/* ── FILTROS ── */}
      {abaGlobal!=="simulacao"&&abaGlobal!=="config"&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:16,display:"flex",gap:24,flexWrap:"wrap",alignItems:"flex-start"}}>

        {/* Período */}
        <div style={{minWidth:280}}>
          <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3,marginBottom:8}}>Período</div>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            {[["semana","Semana"],["mes","Mês"],["trim","Trimestre"],["ano","Ano"]].map(([k,l])=>(
              <button key={k} onClick={()=>setGranular(k)} style={pill(granular===k)}>{l}</button>
            ))}
          </div>
          {granular==="semana"&&<>
            <div style={{display:"flex",gap:6,marginBottom:6}}>
              <button onClick={()=>setSemanasSel(ALL_SEMANAS)} style={sm(false)}>Todos</button>
              <button onClick={()=>setSemanasSel([])} style={sm(false)}>Nenhum</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,maxHeight:120,overflowY:"auto"}}>
              {ALL_SEMANAS.map(s=><button key={s} onClick={()=>setSemanasSel(prev=>prev.includes(s)?prev.filter(x=>x!==s):[...prev,s])} style={sm(semanasSel.includes(s))}>{`S${s}`}</button>)}
            </div>
          </>}
          {granular==="mes"&&<>
            <div style={{display:"flex",gap:6,marginBottom:6}}>
              <button onClick={()=>setMesesSel(ALL_MESES)} style={sm(false)}>Todos</button>
              <button onClick={()=>setMesesSel([])} style={sm(false)}>Nenhum</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {ALL_MESES.map(m=><button key={m} onClick={()=>setMesesSel(prev=>prev.includes(m)?prev.filter(x=>x!==m):[...prev,m])} style={sm(mesesSel.includes(m))}>{MESES_NOME[m]}</button>)}
            </div>
          </>}
          {granular==="trim"&&<div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {[1,2,3,4].map(t=><button key={t} onClick={()=>setTrimestresSel(prev=>prev.includes(t)?prev.filter(x=>x!==t):[...prev,t])} style={sm(trimestresSel.includes(t))}>T{t}</button>)}
          </div>}
        </div>

        {/* Visualização */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3,marginBottom:8}}>Visualização</div>
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            <button onClick={()=>setModo("individual")} style={pill(modo==="individual")}>Individual</button>
            <button onClick={()=>setModo("comparar")} style={pill(modo==="comparar")}>Comparar</button>
          </div>
          <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:13,color:C.cinzaTexto}}>
            <input type="checkbox" checked={semFiltro} onChange={e=>setSemFiltro(e.target.checked)} style={{accentColor:C.laranja}}/>
            Excluir problemas de coleta {semFiltro&&<span style={{color:C.laranja,fontWeight:700}}>⚡</span>}
          </label>
          {modo==="comparar"&&<div style={{marginTop:8,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <select value={compA??""} onChange={e=>setCompA(e.target.value?Number(e.target.value)||e.target.value:null)} style={{border:`1px solid ${C.cinzaBorda}`,borderRadius:6,padding:"4px 8px",fontSize:12}}>
              <option value="">Período A</option>
              {(granular==="semana"?ALL_SEMANAS:granular==="mes"?ALL_MESES:[1,2,3,4]).map(p=><option key={p} value={p}>{lbl(p)}</option>)}
            </select>
            <span style={{color:C.cinzaTexto}}>vs</span>
            <select value={compB??""} onChange={e=>setCompB(e.target.value?Number(e.target.value)||e.target.value:null)} style={{border:`1px solid ${C.cinzaBorda}`,borderRadius:6,padding:"4px 8px",fontSize:12}}>
              <option value="">Período B</option>
              {(granular==="semana"?ALL_SEMANAS:granular==="mes"?ALL_MESES:[1,2,3,4]).map(p=><option key={p} value={p}>{lbl(p)}</option>)}
            </select>
          </div>}
        </div>

        {/* Indicadores */}
        <div>
          <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3,marginBottom:8}}>Indicadores</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {INDICADORES.map(ind=><button key={ind.key} onClick={()=>setIndicSel(prev=>prev.includes(ind.key)?prev.filter(x=>x!==ind.key):[...prev,ind.key])} style={sm(indicSel.includes(ind.key))}>{ind.label}</button>)}
          </div>
        </div>

        {/* Parceiros */}
        {abaGlobal==="parceiros"&&<div style={{flex:1,minWidth:200}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",letterSpacing:0.3}}>Parceiros</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setParceiros(PARCEIROS)} style={{fontSize:11,color:C.azul,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Todos</button>
              <button onClick={()=>setParceiros([])} style={{fontSize:11,color:C.cinzaTexto,cursor:"pointer",background:"none",border:"none",fontWeight:600}}>Nenhum</button>
            </div>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {PARCEIROS.map((p,i)=><button key={p} onClick={()=>setParceiros(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p])} style={sm(parceiros.includes(p),PARC_CORES[i%PARC_CORES.length])}>{p.split(" ")[0]}</button>)}
          </div>
        </div>}
      </div>}


      {/* ══ VISÃO GERAL ══ */}
      {abaGlobal==="geral"&&<div style={{display:"flex",flexDirection:"column",gap:14}}>

        {/* KPIs */}
        {sel.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
          {INDICADORES.filter(i=>indicSel.includes(i.key)).map(ind=>{
            const v=snapGeral[ind.key];
            const cor=sem(v,ind.meta,ind.inv);
            const bg=cor===C.verde?C.verdeLight:cor===C.amarelo?C.amareloLight:C.vermelhoLight;
            return <div key={ind.key} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:"16px 18px",borderLeft:`4px solid ${cor}`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",marginBottom:8}}>{ind.label}</div>
              <div style={{fontSize:32,fontWeight:800,color:cor,lineHeight:1}}>{v!=null?(ind.inv?`${Math.round(v)}d`:`${v.toFixed(1)}%`):"—"}</div>
              <div style={{fontSize:11,color:C.cinzaTexto,marginTop:4}}>meta {ind.inv?`≤${ind.meta}d`:`${ind.meta}%`} · {snapGeral.total??0} coletas</div>
            </div>;
          })}
        </div>}

        {/* Painel variação */}
        {variacaoParceiros.length>0&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontWeight:700,fontSize:14}}>📊 Variação — {variacaoParceiros[0]?.labelAnt} → {variacaoParceiros[0]?.labelAtual}</div>
            <div style={{display:"flex",gap:10,fontSize:12}}>
              {variacaoParceiros.filter(v=>v.temPiora).length>0&&<span style={{color:C.vermelho,fontWeight:700}}>🔴 {variacaoParceiros.filter(v=>v.temPiora).length} pioram</span>}
              {variacaoParceiros.filter(v=>!v.temPiora).length>0&&<span style={{color:C.verde,fontWeight:600}}>✓ {variacaoParceiros.filter(v=>!v.temPiora).length} estáveis</span>}
            </div>
          </div>
          {variacaoParceiros.filter(v=>v.temPiora).map((v,vi)=>(
            <div key={vi} style={{borderTop:`1px solid ${C.cinzaBorda}`,padding:"12px 18px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                <span style={{fontWeight:700,fontSize:13}}>{v.parceiro}</span>
                <span style={{fontSize:11,background:C.vermelhoLight,color:C.vermelho,padding:"2px 8px",borderRadius:999,fontWeight:700}}>🔴 {v.inds.filter(i=>i.piourou).length} piora{v.inds.filter(i=>i.piourou).length>1?"m":""}</span>
                {(()=>{const d=getRaw(v.parceiro,v.pAtual);return d?<span style={{fontSize:11,color:C.cinzaTexto}}>{d.total} coletas</span>:null;})()}
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {v.inds.map((ind,ii)=>{
                  const cor=ind.piourou?(ind.abaixoMeta?C.vermelho:C.amarelo):C.verde;
                  const bg=ind.piourou?(ind.abaixoMeta?C.vermelhoLight:C.amareloLight):C.verdeLight;
                  return <div key={ii} style={{background:bg,borderRadius:8,padding:"6px 12px",minWidth:110,border:`1px solid ${cor}22`}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",marginBottom:2}}>{ind.label}</div>
                    <div style={{fontSize:16,fontWeight:800,color:cor}}>{ind.inv?`${Math.round(ind.vAtual)}d`:`${ind.vAtual.toFixed(1)}%`} {ind.piourou?"↘":"↗"}</div>
                    <div style={{fontSize:11,color:cor}}>{ind.delta>0?"+":""}{ind.inv?Math.round(ind.delta):ind.delta.toFixed(1)}{ind.unit} vs {v.labelAnt}</div>
                  </div>;
                })}
              </div>
            </div>
          ))}
          {variacaoParceiros.filter(v=>!v.temPiora).length>0&&<div style={{padding:"10px 18px",background:C.verdeLight,borderTop:`1px solid ${C.cinzaBorda}`,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:12,color:C.verde,fontWeight:700}}>✓ Mantiveram ou melhoraram:</span>
            {variacaoParceiros.filter(v=>!v.temPiora).map((v,i)=><span key={i} style={{fontSize:12,background:"white",borderRadius:6,padding:"2px 10px",border:`1px solid ${C.verde}44`,color:C.verde,fontWeight:600}}>{v.parceiro.split(" ")[0]}</span>)}
          </div>}
        </div>}

        {/* Top Cidades movido para aba Atrasos */}

        {/* Tabela histórica */}
        <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13}}>Histórico — {sel.map(p=>lbl(p)).join(", ")||"Nenhum período selecionado"}</div>
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:C.cinzaFundo}}>
              {["Período","Coletas",...INDICADORES.filter(i=>indicSel.includes(i.key)).map(i=>i.label),"Prob.","Tendência"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:["Período","Tendência"].includes(h)||h==="Prob."?"center":h==="Coletas"?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            <tbody>{(()=>{
              // Fonte de dados correta por granularidade
              let histRows = [];
              if(granular==="semana"){
                histRows = [...WEEKLY_MERGED.filter(w=>sel.includes(w.s))].reverse().map(w=>({...w,label:`S${w.s}`}));
              } else if(granular==="mes"){
                histRows = [...monthlyData.filter(d=>sel.includes(d.m))].reverse().map(d=>({...d,s:d.m,label:MESES_NOME[d.m]}));
              } else if(granular==="trim"){
                histRows = sel.map(t=>{
                  const ms=(TRIM_MESES[t]||[]).map(m=>monthlyData.find(d=>d.m===m)).filter(Boolean);
                  if(!ms.length) return null;
                  const total=ms.reduce((a,r)=>a+r.total,0);
                  const getW=key=>{let s=0,tv=0;ms.forEach(r=>{if(r[key]!=null){s+=r[key]*r.total;tv+=r.total;}});return tv?Math.round(s/tv*100)/100:null;};
                  const obj={s:t,label:`T${t}`,total,prob:ms.reduce((a,r)=>a+(r.prob||0),0)};
                  INDICADORES.forEach(i=>{obj[i.key]=getW(i.key);obj[i.spKey]=getW(i.spKey);});
                  return obj;
                }).filter(Boolean).reverse();
              } else {
                const all=monthlyData;
                if(!all.length) return null;
                const total=all.reduce((a,r)=>a+r.total,0);
                const getW=key=>{let s=0,t=0;all.forEach(r=>{if(r[key]!=null){s+=r[key]*r.total;t+=r.total;}});return t?Math.round(s/t*100)/100:null;};
                const obj={s:"2026",label:"2026",total,prob:all.reduce((a,r)=>a+(r.prob||0),0)};
                INDICADORES.forEach(i=>{obj[i.key]=getW(i.key);obj[i.spKey]=getW(i.spKey);});
                histRows = [obj];
              }
              return histRows.map((w,i)=>{
                const prev=histRows[i+1];
                const inds=INDICADORES.filter(ind=>indicSel.includes(ind.key));
                return <tr key={w.s} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i===0?"#FFFBF5":"transparent"}}>
                  <td style={{padding:"7px 12px",fontWeight:700,textAlign:"center"}}>{w.label}{i===0&&<span style={{fontSize:10,color:C.laranja,marginLeft:4}}>↑</span>}</td>
                  <td style={{padding:"7px 12px",color:C.cinzaTexto}}>{w.total}</td>
                  {inds.map(ind=><td key={ind.key} style={{padding:"7px 12px",textAlign:"center"}}><Chip v={w[semFiltro?ind.spKey:ind.key]} m={ind.meta} inv={ind.inv} unit={ind.unit}/></td>)}
                  <td style={{padding:"7px 12px",textAlign:"center",color:w.prob>0?C.vermelho:C.verde,fontWeight:700}}>{w.prob}</td>
                  <td style={{padding:"7px 12px",textAlign:"center"}}>{prev?<div style={{display:"flex",gap:2,justifyContent:"center"}}>
                    {inds.map((ind,ii)=>{const v=w[semFiltro?ind.spKey:ind.key],vp=prev[semFiltro?ind.spKey:ind.key];if(v==null||vp==null)return null;const d=v-vp;const m=ind.inv?d<0:d>0;const s=Math.abs(d)<0.5?"→":m?"↗":"↘";const c=Math.abs(d)<0.5?C.cinzaTexto:m?C.verde:C.vermelho;return <span key={ii} title={`${ind.label}: ${d>0?"+":""}${ind.inv?Math.round(d):d.toFixed(1)}${ind.unit}`} style={{color:c,fontSize:13,cursor:"default"}}>{s}</span>;})}
                  </div>:<span style={{color:C.cinzaTexto}}>—</span>}</td>
                </tr>;
              });
            })()}</tbody>
          </table></div>
        </div>
      </div>}


      {/* ══ POR PARCEIRO ══ */}
      {abaGlobal==="parceiros"&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
        {/* Sub-abas */}
        <div style={{display:"flex",gap:4,borderBottom:`1px solid ${C.cinzaBorda}`,background:C.cinzaCard,borderRadius:"12px 12px 0 0",padding:"0 16px",flexWrap:"wrap"}}>
          {[["painel","📊 Painel"],["evolucao","📈 Evolução"],["aging","⏳ Aging Elevado"],["cidades","🗺️ Cidades"],["problemas","⚠️ Problemas"]].map(([k,l])=>(
            <button key={k} onClick={()=>setAbaSub(k)} style={{...hdr(l,abaSub===k),borderRadius:0,borderBottom:abaSub===k?`2px solid ${C.laranja}`:"2px solid transparent",padding:"10px 14px",fontSize:12}}>{l}</button>
          ))}
        </div>

        {/* Painel de Desempenho */}
        {abaSub==="painel"&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontWeight:700,fontSize:13}}>Painel de Desempenho — {sel.map(p=>lbl(p)).join(", ")||"—"}{semFiltro&&" ⚡"}</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={exportarPainel} style={{...pill(false),fontSize:11,color:C.azul}}>📥 CSV</button>
            </div>
          </div>
          {modo==="individual"&&<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:C.cinzaFundo}}>
              {["Parceiro","Coletas",...INDICADORES.filter(i=>indicSel.includes(i.key)).map(i=>i.label),"Prob."].map(h=><th key={h} style={{padding:"8px 12px",textAlign:h==="Parceiro"?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            <tbody>{snapParceiros.map((row,i)=><tr key={row.nome} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
              <td style={{padding:"8px 12px",fontWeight:600,color:PARC_CORES[i%PARC_CORES.length]}}>{row.nome}</td>
              <td style={{padding:"8px 12px",textAlign:"center",color:C.cinzaTexto}}>{row.total}</td>
              {INDICADORES.filter(ind=>indicSel.includes(ind.key)).map(ind=><td key={ind.key} style={{padding:"8px 12px",textAlign:"center"}}><Chip v={row[ind.key]} m={ind.meta} inv={ind.inv} unit={ind.unit}/></td>)}
              <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700,color:row.prob>0?C.vermelho:C.verde}}>{row.prob}</td>
            </tr>)}</tbody>
          </table></div>}
          {modo==="comparar"&&compA!=null&&compB!=null&&<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:C.cinzaFundo}}>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase"}}>Parceiro</th>
              {INDICADORES.filter(i=>indicSel.includes(i.key)).flatMap(ind=>[
                <th key={`${ind.key}_a`} style={{padding:"8px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:C.azul,textTransform:"uppercase",whiteSpace:"nowrap"}}>{ind.label} {lbl(compA)}</th>,
                <th key={`${ind.key}_b`} style={{padding:"8px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:C.laranja,textTransform:"uppercase",whiteSpace:"nowrap"}}>{ind.label} {lbl(compB)}</th>,
                <th key={`${ind.key}_d`} style={{padding:"8px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase"}}>Δ</th>,
              ])}
            </tr></thead>
            <tbody>{parceiros.map((p,i)=>{
              const dA=getRaw(p,compA),dB=getRaw(p,compB);
              return <tr key={p} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
                <td style={{padding:"8px 12px",fontWeight:600,color:PARC_CORES[i%PARC_CORES.length]}}>{p}</td>
                {INDICADORES.filter(ind=>indicSel.includes(ind.key)).flatMap(ind=>{
                  const vA=dA?.[ind.key],vB=dB?.[ind.key];
                  const d=vA!=null&&vB!=null?Math.round((vB-vA)*100)/100:null;
                  const cor=d!=null?(ind.inv?d<=0:d>=0)?C.verde:C.vermelho:C.cinzaTexto;
                  return [
                    <td key={`a`} style={{padding:"8px 12px",textAlign:"center"}}><Chip v={vA} m={ind.meta} inv={ind.inv} unit={ind.unit}/></td>,
                    <td key={`b`} style={{padding:"8px 12px",textAlign:"center"}}><Chip v={vB} m={ind.meta} inv={ind.inv} unit={ind.unit}/></td>,
                    <td key={`d`} style={{padding:"8px 12px",textAlign:"center",fontWeight:700,color:cor,fontSize:12}}>{d!=null?`${d>0?"+":""}${ind.inv?Math.round(d):d.toFixed(1)}${ind.unit}`:"—"}</td>,
                  ];
                })}
              </tr>;
            })}</tbody>
          </table></div>}
        </div>}

        {/* Evolução */}
        {abaSub==="evolucao"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          {parceiros.map((p,pi)=>{
            const cor=PARC_CORES[pi%PARC_CORES.length];
            const dataEvol=(granular==="semana"?ALL_SEMANAS:ALL_MESES).map(per=>{
              const d=getRaw(p,per); if(!d) return null;
              const obj={periodo:lbl(per),total:d.total};
              INDICADORES.forEach(ind=>{obj[ind.key]=d[semFiltro?ind.spKey:ind.key];});
              return obj;
            }).filter(Boolean);
            if(!dataEvol.length) return null;
            return <div key={p} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:16}}>
              <div style={{fontWeight:700,color:cor,marginBottom:12}}>{p}</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={dataEvol} margin={{top:4,right:16,bottom:0,left:-20}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.cinzaBorda}/>
                  <XAxis dataKey="periodo" tick={{fontSize:10}} stroke={C.cinzaBorda}/>
                  <YAxis domain={[60,100]} tick={{fontSize:10}} stroke={C.cinzaBorda}/>
                  <Tooltip formatter={(v,n)=>[v!=null?`${v.toFixed(1)}%`:"—",n]}/>
                  {INDICADORES.filter(i=>indicSel.includes(i.key)&&i.key!=="aging").map((ind,ii)=>(
                    <Line key={ind.key} type="monotone" dataKey={ind.key} stroke={PARC_CORES[ii%PARC_CORES.length]} dot={false} strokeWidth={2} name={ind.label}/>
                  ))}
                  <ReferenceLine y={86} stroke={C.vermelho} strokeDasharray="3 3" strokeWidth={1}/>
                </LineChart>
              </ResponsiveContainer>
            </div>;
          })}
        </div>}

        {/* Aging Elevado */}
        {abaSub==="aging"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          {parceiros.map((p,pi)=>{
            const todas=(granular==="semana"?ALL_SEMANAS:ALL_MESES).map(per=>({per,d:getRaw(p,per)})).filter(x=>x.d&&(x.d.aging||0)>=10);
            if(!todas.length) return null;
            return <div key={p} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13,color:PARC_CORES[pi%PARC_CORES.length]}}>{p} — Períodos com Aging ≥ 10d</div>
              <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:C.cinzaFundo}}>{["Período","Coletas","SLA","Aging","Prob.","Agend.","Aderência"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                <tbody>{todas.map(({per,d},i)=><tr key={per} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
                  <td style={{padding:"7px 12px",textAlign:"center",fontWeight:700}}>{lbl(per)}</td>
                  <td style={{padding:"7px 12px",textAlign:"center",color:C.cinzaTexto}}>{d.total}</td>
                  <td style={{padding:"7px 12px",textAlign:"center"}}><Chip v={d.sla} m={86} inv={false} unit="%"/></td>
                  <td style={{padding:"7px 12px",textAlign:"center"}}><Chip v={d.aging} m={7} inv={true} unit="d"/></td>
                  <td style={{padding:"7px 12px",textAlign:"center",color:d.prob>0?C.vermelho:C.verde,fontWeight:700}}>{d.prob}</td>
                  <td style={{padding:"7px 12px",textAlign:"center"}}><Chip v={d.agend} m={95} inv={false} unit="%"/></td>
                  <td style={{padding:"7px 12px",textAlign:"center"}}><Chip v={d.ader} m={95} inv={false} unit="%"/></td>
                </tr>)}</tbody>
              </table></div>
            </div>;
          })}
        </div>}

        {/* Cidades/Estado */}
        {abaSub==="cidades"&&(rawRows.length===0
          ?<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:24,textAlign:"center",color:C.cinzaTexto}}>📂 Carregue um CSV para ver a análise por cidade.</div>
          :(()=>{
            const base=filtrarPorPeriodo(rawRows.filter(r=>r["Flag Situacao Coleta"]==="Coletado"));
            return PARCEIROS.filter(p=>parceiros.includes(p)).map((p,pi)=>{
              const tc=semFiltro?base.filter(r=>r["Transportadora"]===p&&r["Problema_de_coleta"]!=="1"&&r["Problema_de_coleta"]!==1):base.filter(r=>r["Transportadora"]===p);
              if(!tc.length) return null;
              const cidMap={};
              tc.forEach(r=>{const k=`${r["Cidade"]||"N/A"} (${r["Estado"]||""})`;if(!cidMap[k])cidMap[k]={t:0,a:0};cidMap[k].t++;if(norm(r["Vencido"])==="Sim")cidMap[k].a++;});
              const cids=Object.entries(cidMap).filter(([,v])=>v.t>=3).sort((a,b)=>b[1].a/b[1].t-a[1].a/a[1].t).slice(0,15);
              if(!cids.length) return null;
              return <div key={p} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13,color:PARC_CORES[pi%PARC_CORES.length]}}>{p}</div>
                <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:C.cinzaFundo}}>{["Cidade/Estado","Total","Atrasos","% Atraso"].map(h=><th key={h} style={{padding:"7px 12px",textAlign:h==="Cidade/Estado"?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
                  <tbody>{cids.map(([loc,v],i)=>{const pct2=Math.round(v.a/v.t*100);const cor=pct2>30?C.vermelho:pct2>15?C.amarelo:C.verde;return <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
                    <td style={{padding:"7px 12px",fontWeight:500}}>{loc}</td>
                    <td style={{padding:"7px 12px",textAlign:"center",color:C.cinzaTexto}}>{v.t}</td>
                    <td style={{padding:"7px 12px",textAlign:"center",fontWeight:700,color:C.vermelho}}>{v.a}</td>
                    <td style={{padding:"7px 12px",textAlign:"center"}}><span style={{fontWeight:700,color:cor,background:cor===C.verde?C.verdeLight:cor===C.amarelo?C.amareloLight:C.vermelhoLight,padding:"2px 8px",borderRadius:6}}>{pct2}%</span></td>
                  </tr>;})}
                  </tbody>
                </table></div>
              </div>;
            }).filter(Boolean);
          })()
        )}

        {/* Problemas */}
        {abaSub==="problemas"&&(rawRows.length===0
          ?<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:24,textAlign:"center",color:C.cinzaTexto}}>📂 Carregue um CSV para ver a análise de problemas.</div>
          :(()=>{
            const ACOES={"Cliente ausente":"Acionar cliente 24h antes","Telefone Inválido":"Atualizar contato","NF errada":"Verificar documentação","Cliente desistiu":"Contato preventivo","Endereço não localizado":"Validar endereço antes do agendamento"};
            const base=filtrarPorPeriodo(rawRows.filter(r=>r["Flag Situacao Coleta"]==="Coletado"&&(r["Problema_de_coleta"]==="1"||r["Problema_de_coleta"]===1)));
            return PARCEIROS.filter(p=>parceiros.includes(p)).map((p,pi)=>{
              const tc=base.filter(r=>r["Transportadora"]===p);
              if(!tc.length) return null;
              const motMap={};
              tc.forEach(r=>{const m=r["Problema Motivo"]||"Sem motivo";if(!motMap[m])motMap[m]={c:0,a:0,cids:{}};motMap[m].c++;if(norm(r["Vencido"])==="Sim")motMap[m].a++;const c=`${r["Cidade"]||"N/A"}`;motMap[m].cids[c]=(motMap[m].cids[c]||0)+1;});
              const mots=Object.entries(motMap).sort((a,b)=>b[1].c-a[1].c);
              return <div key={p} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13,color:PARC_CORES[pi%PARC_CORES.length]}}>{p} — {tc.length} problemas</div>
                <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead><tr style={{background:C.cinzaFundo}}>{["Motivo","Ocorr.","c/ Atraso","Cidade principal","Ação sugerida"].map(h=><th key={h} style={{padding:"7px 12px",textAlign:h==="Motivo"||h==="Ação sugerida"||h==="Cidade principal"?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
                  <tbody>{mots.map(([mot,v],i)=><tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
                    <td style={{padding:"7px 12px",fontWeight:500}}>{mot}</td>
                    <td style={{padding:"7px 12px",textAlign:"center",fontWeight:700}}>{v.c}</td>
                    <td style={{padding:"7px 12px",textAlign:"center",color:v.a>0?C.vermelho:C.cinzaTexto,fontWeight:v.a>0?700:400}}>{v.a}</td>
                    <td style={{padding:"7px 12px",color:C.cinzaTexto,fontSize:11}}>{Object.entries(v.cids).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—"}</td>
                    <td style={{padding:"7px 12px",fontSize:11,color:C.azul}}>{ACOES[mot]||"Investigar causa"}</td>
                  </tr>)}
                  </tbody>
                </table></div>
              </div>;
            }).filter(Boolean);
          })()
        )}
      </div>}

      {/* ══ ATRASOS ══ */}
      {abaGlobal==="atrasos"&&(rawRows.length===0
        ?<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:32,textAlign:"center",color:C.cinzaTexto}}>
            <div style={{fontSize:24,marginBottom:8}}>⏰</div>
            <div style={{fontWeight:700,fontSize:15,color:C.texto,marginBottom:6}}>Atrasos por Faixa de Aging</div>
            <div>Carregue um CSV para ver as coletas em atraso agrupadas por faixa de dias.</div>
          </div>
        :<AbaAtrasos rawRows={rawRows} filtrarPorPeriodo={filtrarPorPeriodo} sel={sel} lbl={lbl}/>
      )}


      {/* ══ PROBLEMAS DE COLETA ══ */}
      {abaGlobal==="problemas_tab"&&(rawRows.length===0
        ?<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:32,textAlign:"center",color:C.cinzaTexto}}>
            <div style={{fontSize:24,marginBottom:8}}>⚠️</div>
            <div style={{fontWeight:700,fontSize:15,color:C.texto,marginBottom:6}}>Problemas de Coleta</div>
            <div>Carregue um CSV para ver a análise de problemas.</div>
          </div>
        :<AbaProblemas rawRows={rawRows} filtrarPorPeriodo={filtrarPorPeriodo} sel={sel} lbl={lbl}/>
      )}
      {/* ══ RELATÓRIOS ══ */}
      {abaGlobal==="comparar"&&<AbaCompararCSVs
        parseCSVFn={parseCSV}
        busdays_r={busdays}
        norm_r={norm}
        PARC_CORES_R={PARC_CORES}
        FAIXAS_AGING_R={FAIXAS_AGING}
      />}

      {abaGlobal==="relatorios"&&<AbaRelatorios
        rawRows={rawRows}
        weeklyMerged={WEEKLY_MERGED}
        pdMerged={PD_MERGED}
        monthlyData={monthlyData}
        parceirosDisp={PARCEIROS}
        sel={sel} lbl={lbl} granular={granular} semFiltro={semFiltro}
        INDICADORES_R={INDICADORES}
        PARC_CORES_R={PARC_CORES}
        FAIXAS_AGING_R={FAIXAS_AGING}
        busdays_r={busdays}
        norm_r={norm}
        pct_r={pct}
      />}

      {/* ══ SIMULAÇÃO ══ */}
      {abaGlobal==="simulacao"&&(()=>{
        const TAXA=11.24, GMV_MED=201.6, BASE_REV=2320;
        const DIST={11:0,12:0.35,1:0.50,2:0.15};
        const PESOS={"SAFARI MONTAGEM":51.7,"MOVEL SERVICE":14.4,"SALDAO CAMPINAS":12.9,"LOGME - TRANSPO":6.2,"OUTELETRO BH":5.6,"AGMX OPORTUNIDA":3.8,"KMAN MOVEIS":2.7,"ORC MOVEIS E EL":2.7};
        const MESES_SIM=[{m:11,label:"Novembro",base:BASE_REV},{m:12,label:"Dezembro",base:Math.round(BASE_REV*0.83)},{m:1,label:"Janeiro",base:Math.round(BASE_REV*1.01)},{m:2,label:"Fevereiro",base:Math.round(BASE_REV*0.86)}];
        const gmvEx=GMV_MED*(simAumentoVendas/100);
        const cEx=m=>Math.round(gmvEx*(DIST[m.m]||0)*TAXA);
        const totEx=MESES_SIM.reduce((a,m)=>a+cEx(m),0);
        const totTot=MESES_SIM.reduce((a,m)=>a+m.base+cEx(m),0);
        const totAtr=MESES_SIM.reduce((a,m)=>a+Math.round((m.base+cEx(m))*(1-simSLAEsperado/100)),0);
        const p2=pill;
        return <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:20}}>
            <div style={{fontWeight:800,fontSize:16,marginBottom:6}}>📈 Simulação — Black Friday</div>
            <div style={{fontSize:13,color:C.cinzaTexto,marginBottom:10}}>Calibrada com dados reais Jan/2025–Jun/2026 · Taxa {TAXA} rev/R$1M · Impacto começa na 2ª quinzena de Dez</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {[{l:"Taxa reversa",v:`${TAXA} rev/R$1M`,c:C.azul},{l:"Base mensal",v:`${BASE_REV.toLocaleString('pt-BR')} rev`,c:C.verde},{l:"GMV médio",v:`R$${GMV_MED}M`,c:C.roxo},{l:"Distribuição",v:"Dez 35% · Jan 50% · Fev 15%",c:C.laranja}].map(({l,v,c},i)=>(
                <div key={i} style={{fontSize:11,background:C.cinzaFundo,border:`1px solid ${C.cinzaBorda}`,borderRadius:8,padding:"5px 12px"}}><span style={{color:C.cinzaTexto}}>{l}: </span><span style={{fontWeight:700,color:c}}>{v}</span></div>
              ))}
            </div>
          </div>
          <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:20}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:16}}>⚙️ Parâmetros</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:20}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",marginBottom:6}}>Aumento de Vendas BF</div>
                <div style={{fontSize:11,color:C.cinzaTexto,marginBottom:8}}>Histórico BF/25: +79% vs mês médio</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>{[30,50,79,100,150].map(v=><button key={v} onClick={()=>setSimAumentoVendas(v)} style={p2(simAumentoVendas===v)}>+{v}%</button>)}</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}><input type="range" min={10} max={200} value={simAumentoVendas} onChange={e=>setSimAumentoVendas(Number(e.target.value))} style={{flex:1,accentColor:C.laranja}}/><span style={{fontWeight:800,fontSize:20,color:C.laranja,minWidth:54}}>+{simAumentoVendas}%</span></div>
                <div style={{fontSize:11,color:C.cinzaTexto,marginTop:4}}>GMV BF: <strong>R${Math.round(GMV_MED*(1+simAumentoVendas/100))}M</strong> · extra: R${Math.round(gmvEx)}M</div>
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",marginBottom:6}}>SLA Esperado no Pico</div>
                <div style={{fontSize:11,color:C.cinzaTexto,marginBottom:8}}>Meta global: 86%</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>{[78,80,82,84,86].map(v=><button key={v} onClick={()=>setSimSLAEsperado(v)} style={p2(simSLAEsperado===v,v>=86?C.verde:C.vermelho)}>{v}%</button>)}</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}><input type="range" min={60} max={96} value={simSLAEsperado} onChange={e=>setSimSLAEsperado(Number(e.target.value))} style={{flex:1,accentColor:simSLAEsperado>=86?C.verde:C.vermelho}}/><span style={{fontWeight:800,fontSize:20,color:simSLAEsperado>=86?C.verde:C.vermelho,minWidth:48}}>{simSLAEsperado}%</span></div>
              </div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
            {[{l:"Reversas extras Dez–Fev",v:totEx.toLocaleString('pt-BR'),c:C.laranja},{l:"Total reversas no período",v:totTot.toLocaleString('pt-BR'),c:C.azul},{l:"Atrasos estimados",v:totAtr.toLocaleString('pt-BR'),c:C.vermelho},{l:"Aumento sobre base",v:`+${Math.round(totEx/MESES_SIM.reduce((a,m)=>a+m.base,0)*100)}%`,c:C.roxo}].map(({l,v,c},i)=>(
              <div key={i} style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:"14px 18px",borderLeft:`4px solid ${c}`}}>
                <div style={{fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",marginBottom:4}}>{l}</div>
                <div style={{fontSize:26,fontWeight:800,color:c,lineHeight:1}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13}}>Projeção Mensal</div>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{background:C.cinzaFundo}}>{["Mês","Contexto","Base","Extras BF","Total","% Impacto","Atrasos","Pressão"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:["Mês","Contexto"].includes(h)?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
              <tbody>{MESES_SIM.map((m,i)=>{
                const e=cEx(m),t=m.base+e,at=Math.round(t*(1-simSLAEsperado/100)),d=(DIST[m.m]||0)*100,pr=t/m.base;
                const cor=pr>=1.20?C.vermelho:pr>=1.08?C.amarelo:C.verde;const bg=pr>=1.20?C.vermelhoLight:pr>=1.08?C.amareloLight:C.verdeLight;
                return <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
                  <td style={{padding:"8px 12px",fontWeight:700}}>{m.label}</td>
                  <td style={{padding:"8px 12px",fontSize:11,color:C.cinzaTexto}}>{d>0?`${d}% do impacto BF`:"Vendas — sem reversas ainda"}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",color:C.cinzaTexto}}>{m.base.toLocaleString('pt-BR')}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",color:e>0?C.laranja:C.cinzaTexto,fontWeight:e>0?700:400}}>{e>0?`+${e}`:"—"}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700}}>{t.toLocaleString('pt-BR')}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",color:d>0?C.laranja:C.cinzaTexto}}>{d>0?`${d}%`:"—"}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",color:C.vermelho,fontWeight:600}}>{at}</td>
                  <td style={{padding:"8px 12px",textAlign:"center"}}><span style={{fontSize:11,background:bg,color:cor,padding:"3px 10px",borderRadius:999,fontWeight:700,whiteSpace:"nowrap"}}>{pr>=1.20?"🔴 Alta":pr>=1.08?"⚠️ Média":"✓ Normal"}{e>0?` (+${Math.round((pr-1)*100)}%)`:""}</span></td>
                </tr>;
              })}</tbody>
            </table></div>
          </div>
          <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.cinzaBorda}`,fontWeight:700,fontSize:13}}>Por Parceiro — Reversas Extras <span style={{fontSize:11,color:C.cinzaTexto,fontWeight:400}}>peso histórico Abr–Jun/26</span></div>
            <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{background:C.cinzaFundo}}>{["Parceiro","Peso","+ Dez","+ Jan","+ Fev","Total extras"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:h==="Parceiro"?"left":"center",fontSize:10,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
              <tbody>{Object.entries(PESOS).sort((a,b)=>b[1]-a[1]).map(([p,pct],i)=>{
                const eDez=Math.round(totEx*0.35*pct/100),eJan=Math.round(totEx*0.50*pct/100),eFev=Math.round(totEx*0.15*pct/100);
                return <tr key={p} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i%2===0?"transparent":C.cinzaFundo}}>
                  <td style={{padding:"8px 12px",fontWeight:600}}>{p}</td>
                  <td style={{padding:"8px 12px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{height:6,width:`${Math.max(pct*1.4,4)}px`,background:C.laranja,borderRadius:3}}/><span style={{color:C.cinzaTexto,fontSize:12}}>{pct}%</span></div></td>
                  <td style={{padding:"8px 12px",textAlign:"center",color:C.laranja}}>+{eDez}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",color:C.vermelho,fontWeight:700}}>+{eJan}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",color:C.cinzaTexto}}>+{eFev}</td>
                  <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700,color:C.laranja}}>+{eDez+eJan+eFev}</td>
                </tr>;
              })}</tbody>
            </table></div>
          </div>
        </div>;
      })()}


      {/* ══ CONFIGURAÇÕES ══ */}
      {abaGlobal==="config"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>

        {/* Cache de semanas */}
        {weeklyExtra.length>0&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:700,fontSize:14}}>💾 Cache de Semanas</div>
            <div style={{fontSize:12,color:C.cinzaTexto,marginTop:2}}>Semanas salvas: <strong>S{weeklyExtra.map(w=>w.s).join(", S")}</strong></div>
          </div>
          <button onClick={()=>{if(!window.confirm("Limpar cache de semanas? Os dados serão recalculados no próximo upload.")) return;try{localStorage.removeItem("slaParca_weekly");localStorage.removeItem("slaParca_pd");}catch{}setWeeklyExtra([]);setPdExtra({});}} style={{fontSize:11,color:C.vermelho,background:C.vermelhoLight,border:`1px solid ${C.vermelho}`,borderRadius:6,padding:"4px 12px",cursor:"pointer",fontWeight:600}}>🗑️ Limpar cache</button>
        </div>}

        {/* Variações de volume */}
        {variacaoVol.length>0&&<div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.cinzaBorda}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:700,fontSize:14}}>📈 Variações de Volume entre Uploads</div><div style={{fontSize:12,color:C.cinzaTexto,marginTop:2}}>Diferenças detectadas ao subir novos CSVs.</div></div>
            <button onClick={()=>{if(!window.confirm("Limpar histórico de variações?")) return;try{localStorage.removeItem("slaParca_var");}catch{}setVariacaoVol([]);}} style={{fontSize:11,color:C.cinzaTexto,background:C.cinzaFundo,border:`1px solid ${C.cinzaBorda}`,borderRadius:6,padding:"4px 12px",cursor:"pointer"}}>🗑️ Limpar</button>
          </div>
          <div style={{display:"flex",flexDirection:"column"}}>
            {[...variacaoVol].reverse().map((entry,ei)=>(
              <div key={ei} style={{borderTop:ei>0?`1px solid ${C.cinzaBorda}`:"none"}}>
                <div style={{padding:"10px 20px",background:C.cinzaFundo,display:"flex",gap:12,alignItems:"center"}}>
                  <span style={{fontSize:11,color:C.cinzaTexto}}>{entry.data}</span>
                  <span style={{fontSize:12,fontWeight:700}}>{entry.arquivo}</span>
                  <span style={{fontSize:11,color:C.cinzaTexto}}>{entry.variacoes?.length||0} semana{(entry.variacoes?.length||0)!==1?"s":""} com variação</span>
                </div>
                {(entry.variacoes||[]).map((v,vi)=>{
                  const cor=v.diff>0?C.verde:C.vermelho;
                  const bg=v.diff>0?C.verdeLight:C.vermelhoLight;
                  return <div key={vi} style={{padding:"12px 20px",borderTop:`1px solid ${C.cinzaBorda}`}}>
                    {/* Geral da semana */}
                    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:v.porParceiro?.length>0?10:0}}>
                      <span style={{fontWeight:800,fontSize:15,minWidth:36,color:C.texto}}>S{v.semana}</span>
                      <div style={{display:"flex",alignItems:"center",gap:8,background:C.cinzaFundo,borderRadius:8,padding:"6px 12px"}}>
                        <span style={{fontSize:11,color:C.cinzaTexto,fontWeight:700}}>EFETIVADAS</span>
                        <span style={{color:C.cinzaTexto,fontSize:12}}>{v.totalAnt} → {v.totalNovo}</span>
                        <span style={{fontWeight:800,color:cor,background:bg,padding:"2px 10px",borderRadius:5,fontSize:13}}>
                          {v.diff>0?"+":""}{v.diff}
                        </span>
                      </div>
                    </div>
                    {/* Por parceiro */}
                    {v.porParceiro?.length>0&&<div style={{display:"flex",gap:8,flexWrap:"wrap",paddingLeft:52}}>
                      {v.porParceiro.map((pp,ppi)=>{
                        const cP=pp.diff>0?C.verde:C.vermelho;
                        const bP=pp.diff>0?C.verdeLight:C.vermelhoLight;
                        return <div key={ppi} style={{background:C.cinzaFundo,borderRadius:8,padding:"6px 12px",border:`1px solid ${C.cinzaBorda}`,minWidth:140}}>
                          <div style={{fontSize:11,fontWeight:700,color:C.texto,marginBottom:3}}>{pp.parceiro.split(" ")[0]}</div>
                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            <span style={{fontSize:11,color:C.cinzaTexto}}>{pp.antes} → {pp.depois}</span>
                            <span style={{fontWeight:800,color:cP,background:bP,padding:"1px 7px",borderRadius:4,fontSize:12}}>
                              {pp.diff>0?"+":""}{pp.diff}
                            </span>
                          </div>
                        </div>;
                      })}
                    </div>}
                  </div>;
                })}
              </div>
            ))}
          </div>
        </div>}

        {/* Histórico de uploads */}
        <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.cinzaBorda}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:700,fontSize:14}}>📂 Histórico de Uploads</div><div style={{fontSize:12,color:C.cinzaTexto,marginTop:2}}>CSVs importados — salvo entre sessões.</div></div>
            {uploadHistory.length>0&&<button onClick={()=>{if(!window.confirm("Limpar histórico?")) return;try{localStorage.removeItem("slaParca_hist");}catch{}setUploadHistory([]);}} style={{fontSize:11,color:C.cinzaTexto,background:C.cinzaFundo,border:`1px solid ${C.cinzaBorda}`,borderRadius:6,padding:"4px 12px",cursor:"pointer"}}>🗑️ Limpar</button>}
          </div>
          {uploadHistory.length===0
            ?<div style={{padding:20,color:C.cinzaTexto,fontSize:13,textAlign:"center"}}>Nenhum CSV importado ainda.</div>
            :<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{background:C.cinzaFundo}}>{["#","Arquivo","Data / Hora","Linhas"].map(h=><th key={h} style={{padding:"8px 14px",textAlign:h==="Arquivo"?"left":"center",fontSize:11,fontWeight:700,color:C.cinzaTexto,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
              <tbody>{[...uploadHistory].reverse().map((u,i)=>(
                <tr key={i} style={{borderTop:`1px solid ${C.cinzaBorda}`,background:i===0?C.verdeLight:"transparent"}}>
                  <td style={{padding:"8px 14px",textAlign:"center",color:C.cinzaTexto}}>{uploadHistory.length-i}</td>
                  <td style={{padding:"8px 14px",fontWeight:600}}>{u.nome}</td>
                  <td style={{padding:"8px 14px",textAlign:"center",color:C.cinzaTexto}}>{u.data}</td>
                  <td style={{padding:"8px 14px",textAlign:"center",color:C.cinzaTexto}}>{u.total?.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table></div>
          }
        </div>

        {/* Roadmap */}
        <div style={{background:C.cinzaCard,border:`1px solid ${C.cinzaBorda}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.cinzaBorda}`,background:C.azulLight}}>
            <div style={{fontWeight:700,fontSize:14,color:C.azul}}>🚀 Roadmap</div>
          </div>
          {[
            {h:"2025–2026",items:[{t:"Metas Dinâmicas por Parceiro",d:"Editar metas direto no dashboard"},{t:"Metas Sazonais",d:"Metas diferentes por mês/trimestre"},{t:"Alerta de Tendência Consecutiva",d:"3+ semanas em queda no mesmo indicador"},{t:"Projeção de SLA para o Fim da Semana",d:"Estimativa com dados parciais"}]},
            {h:"2027+",items:[{t:"Mapa de Calor por Dia da Semana",d:"SLA por dia da semana"},{t:"Tempo Solicitação → Agendamento",d:"Gap não medido hoje"},{t:"Reincidência de Problemas",d:"Pedidos com problema repetido"},{t:"Registro de Ações do Time",d:"Fechar ciclo análise → ação"},{t:"Benchmark entre Parceiros",d:"Por faixa de volume"},{t:"Exportação PDF para Reuniões",d:"PDF formatado com um clique"}]},
          ].map(({h,items},gi)=>(
            <div key={gi}>
              <div style={{padding:"8px 20px",background:C.cinzaFundo,borderTop:`1px solid ${C.cinzaBorda}`}}><span style={{fontSize:11,fontWeight:700,color:C.azul,textTransform:"uppercase"}}>{h}</span></div>
              {items.map((item,i)=>(
                <div key={i} style={{padding:"12px 20px",borderTop:`1px solid ${C.cinzaBorda}`,display:"flex",gap:12,alignItems:"flex-start"}}>
                  <span style={{fontSize:10,background:C.azulLight,color:C.azul,padding:"2px 8px",borderRadius:999,fontWeight:700,flexShrink:0,marginTop:2}}>Planejado</span>
                  <div><div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{item.t}</div><div style={{fontSize:12,color:C.cinzaTexto}}>{item.d}</div></div>
                </div>
              ))}
            </div>
          ))}
        </div>

      </div>}

    </div>
  </div>;
}
