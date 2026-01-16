// attention2 – version ROBUSTE
// Séquence attentionnelle + bips planifiés (comme attention1)
// Nombre de bips choisi AVANT le démarrage, moments aléatoires

const els = {
  status: document.getElementById("status"),
  timer: document.getElementById("timer"),
  cueLabel: document.getElementById("cueLabel"),
  cueSub: document.getElementById("cueSub"),
  btnPlus: document.getElementById("btnPlus"),
  btnMinus: document.getElementById("btnMinus"),
  startBtn: document.getElementById("startBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  resetBtn: document.getElementById("resetBtn"),
  durationSelect: document.getElementById("durationSelect"),
  beepCountSelect: document.getElementById("beepCountSelect"),
};

const CONFIG = {
  minISI: 2200,
  maxISI: 4200,
  pPlus: 0.5,
  avoidLongRuns: true,
  maxRunLength: 3,
  showCueTextMs: 700,
  minInterTapMs: 120,

  // Bip
  beepDurationMs: 200,
  beepFreqHz: 880,
  beepGain: 0.15,
};

const state = {
  running: false,
  startPerf: 0,
  runDurationMs: 600000,
  rafId: null,
  timeouts: [],
  lastTapPerf: 0,

  trialCount: 0,
  currentCue: null,
  lastCueLabel: null,
  lastRunLength: 0,

  pendingDistractorTag: null,
  logs: [],
};

function nowPerf(){ return performance.now(); }
function schedule(fn, ms){ const id = setTimeout(fn, ms); state.timeouts.push(id); }
function clearScheduled(){ state.timeouts.forEach(clearTimeout); state.timeouts=[]; if(state.rafId) cancelAnimationFrame(state.rafId); }
function fmtSeconds(ms){ return (ms/1000).toFixed(1).padStart(4,"0")+"s"; }

function setStatus(t){ els.status.textContent=t; }
function setCue(a,b=""){ els.cueLabel.textContent=a; els.cueSub.textContent=b; }

function randBetween(a,b){ return a + Math.random()*(b-a); }

function pickCueLabel(){
  let l = Math.random()<CONFIG.pPlus ? "PLUS":"MOINS";
  if(CONFIG.avoidLongRuns && l===state.lastCueLabel && state.lastRunLength>=CONFIG.maxRunLength){
    l = l==="PLUS"?"MOINS":"PLUS";
  }
  return l;
}

function updateRunStats(l){
  if(l===state.lastCueLabel) state.lastRunLength++;
  else { state.lastRunLength=1; state.lastCueLabel=l; }
}

function cueToCorrect(l){ return l==="PLUS"?"+":"-"; }

// 🔊 Bip SIMPLE (HTML Audio → ultra compatible)
const beepAudio = new Audio();
beepAudio.src =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

function playBeep(){
  const ctx = new (window.AudioContext||window.webkitAudioContext)();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = CONFIG.beepFreqHz;
  g.gain.value = CONFIG.beepGain;
  o.connect(g); g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + CONFIG.beepDurationMs/1000);
}

// 🧠 Planification des bips (CLÉ)
function scheduleRandomBeeps(){
  const n = Number(els.beepCountSelect.value||0);
  if(n<=0) return;

  for(let i=0;i<n;i++){
    const t = Math.random()*state.runDurationMs;
    schedule(()=>{
      if(!state.running) return;
      playBeep();
      state.pendingDistractorTag="post_beep";
    }, t);
  }
}

// --- moteur ---
function presentCue(){
  if(state.currentCue && !state.currentCue.responded){
    const p=state.currentCue;
    state.logs.push({...p, omission:1});
  }

  const l = pickCueLabel(); updateRunStats(l);
  const t0 = nowPerf();
  const rel = Math.round(t0-state.startPerf);
  const tag = state.pendingDistractorTag||"baseline";
  state.pendingDistractorTag=null;

  state.currentCue={
    trialIndex:state.trialCount,
    cueLabel:l,
    correct:cueToCorrect(l),
    cueTimePerf:t0,
    cueTimeRelMs:rel,
    distractorWindow:tag,
    responded:false
  };

  setCue("Consigne : "+l,"Répondez avec + / −");
  schedule(()=>setCue("Continuez…",""),CONFIG.showCueTextMs);
  state.trialCount++;
}

function scheduleNextCue(){
  if(!state.running) return;
  const e = nowPerf()-state.startPerf;
  if(e>=state.runDurationMs){ stopRun(); return; }
  schedule(()=>{ presentCue(); scheduleNextCue(); }, randBetween(CONFIG.minISI,CONFIG.maxISI));
}

function handleResponse(c){
  if(!state.running) return;
  const t=nowPerf();
  if(t-state.lastTapPerf<CONFIG.minInterTapMs) return;
  state.lastTapPerf=t;
  const cue=state.currentCue;
  if(!cue||cue.responded) return;
  cue.responded=true;
  state.logs.push({
    ...cue,
    choice:c,
    correct:c===cue.correct?1:0,
    rtMs:Math.round(t-cue.cueTimePerf),
    omission:0
  });
}

function updateTimer(){
  if(!state.running) return;
  els.timer.textContent=fmtSeconds(nowPerf()-state.startPerf);
  state.rafId=requestAnimationFrame(updateTimer);
}

function startRun(){
  if(state.running) return;
  clearScheduled();
  state.logs=[]; state.trialCount=0; state.currentCue=null;
  state.lastCueLabel=null; state.lastRunLength=0; state.pendingDistractorTag=null;

  state.runDurationMs=Number(els.durationSelect.value||600000);
  state.startPerf=nowPerf(); state.running=true;

  setStatus("En cours");
  els.downloadBtn.disabled=true; els.resetBtn.disabled=false;
  updateTimer();

  scheduleRandomBeeps();   // ⭐⭐⭐
  presentCue();
  scheduleNextCue();
  schedule(()=>stopRun(),state.runDurationMs);
}

function stopRun(){
  if(!state.running) return;
  state.running=false; clearScheduled();
  setStatus("Terminé");
  els.downloadBtn.disabled=false;
}

function resetAll(){
  clearScheduled(); state.running=false; state.logs=[];
  setStatus("Prêt"); els.timer.textContent="00.0s";
}

function exportCSV(){
  const rows=[["trialIndex","cueLabel","choice","correct","rtMs","cueTimeRelMs","distractorWindow","omission"].join(",")];
  state.logs.forEach(r=>rows.push([
    r.trialIndex,r.cueLabel,r.choice||"",r.correct||"",r.rtMs||"",
    r.cueTimeRelMs,r.distractorWindow,r.omission
  ].join(",")));
  const b=new Blob([rows.join("\n")],{type:"text/csv"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(b);
  a.download="attention2.csv"; a.click();
}

els.btnPlus.onclick=()=>state.running?handleResponse("+"):startRun();
els.btnMinus.onclick=()=>state.running?handleResponse("-"):startRun();
els.startBtn.onclick=startRun;
els.resetBtn.onclick=resetAll;
els.downloadBtn.onclick=exportCSV;

resetAll();
