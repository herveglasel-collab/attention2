// attention2 – STABLE
// - Durée variable (menu existant)
// - Nombre de bips choisi avant démarrage (menu beepCountSelect)
// - Moments des bips aléatoires (planifiés au démarrage)
// - Séquence PLUS/MOINS aléatoire + ISI variable
// - Omissions loggées proprement
// - CSV complet

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
  beepMode: document.getElementById("beepMode"),
beepLow: document.getElementById("beepLow"),
beepMid: document.getElementById("beepMid"),
beepHigh: document.getElementById("beepHigh"),

};

const CONFIG = {
  // essais
  minISI: 2200,
  maxISI: 4200,
  pPlus: 0.5,
  avoidLongRuns: true,
  maxRunLength: 3,
  showCueTextMs: 700,
  minInterTapMs: 120,

  // bip
  beepDurationMs: 180,
  beepFreqHz: 880,
  beepGain: 0.16, // si trop fort: 0.10–0.12
};

// ---- Etat ----
const state = {
  running: false,
  startPerf: 0,
  runDurationMs: 600000,
  rafId: null,
  timeouts: [],

  lastTapPerf: 0,

  trialCount: 0,
  currentCue: null,     // consigne active (pour RT + omission)
  lastCueLabel: null,
  lastRunLength: 0,

  pendingTag: null,     // ex: "post_beep" appliqué à la prochaine consigne
  logs: [],

  // AudioContext unique
  audioCtx: null,
  masterGain: null,
};

// ---- Utils ----
function nowPerf(){ return performance.now(); }

function schedule(fn, ms){
  const id = setTimeout(fn, ms);
  state.timeouts.push(id);
}

function clearScheduled(){
  state.timeouts.forEach(clearTimeout);
  state.timeouts = [];
  if(state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
}
function speak(text){
  if(!("speechSynthesis" in window)) return;

  // Important : on annule la précédente pour éviter les empilements
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 1.0;

  window.speechSynthesis.speak(u);
}
function fmtSeconds(ms){
  return (ms/1000).toFixed(1).padStart(4, "0") + "s";
}

function setStatus(t){ els.status.textContent = t; }
function setCue(a,b=""){ els.cueLabel.textContent=a; els.cueSub.textContent=b; }

function randBetween(a,b){ return a + Math.random()*(b-a); }

function sliderToGain(v01){ // 0..100 -> 0.00..0.40
  const v = Math.max(0, Math.min(100, Number(v01) || 0));
  return (v / 100) * 0.40;
}

function pickBeepGain(){
  const mode = els.beepMode?.value || "fixed";

  if(mode === "random3"){
    const low = Number(els.beepLow?.value ?? 20);
    const mid = Number(els.beepMid?.value ?? 35);
    const high = Number(els.beepHigh?.value ?? 55);

    const levels = [
      { name: "low", v: low },
      { name: "mid", v: mid },
      { name: "high", v: high },
    ];

    const chosen = levels[Math.floor(Math.random() * levels.length)];
    return { gain: sliderToGain(chosen.v), level: chosen.name, raw: chosen.v };
  }

  // Mode fixe : on utilise la valeur actuelle de CONFIG.beepGain (ou un slider beepVolume si vous l'avez)
  const vFixed = Number(document.getElementById("beepVolume")?.value ?? 35);
  return { gain: sliderToGain(vFixed), level: "fixed", raw: vFixed };
}


// ---- Random PLUS/MOINS ----
function pickCueLabel(){
  let l = (Math.random() < CONFIG.pPlus) ? "PLUS" : "MOINS";

  if(CONFIG.avoidLongRuns && state.trialCount >= 1){
    const last = state.lastCueLabel;
    const runLen = state.lastRunLength || 1;
    if(l === last && runLen >= CONFIG.maxRunLength){
      l = (last === "PLUS") ? "MOINS" : "PLUS";
    }
  }
  return l;
}

function updateRunStats(l){
  if(l === state.lastCueLabel) state.lastRunLength = (state.lastRunLength || 1) + 1;
  else { state.lastRunLength = 1; state.lastCueLabel = l; }
}

function cueToCorrect(l){ return (l === "PLUS") ? "+" : "-"; }

// ---- Audio (bip) : init + play ----
function initAudioIfNeeded(){
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if(!AudioContext) return;

  if(!state.audioCtx){
    state.audioCtx = new AudioContext();
    state.masterGain = state.audioCtx.createGain();
    state.masterGain.gain.value = 1.0;
    state.masterGain.connect(state.audioCtx.destination);
  }
  if(state.audioCtx.state === "suspended"){
    // doit être appelé après un geste utilisateur -> startRun() est déclenché par tap/clic
    state.audioCtx.resume();
  }
}

function playBeep(){
  try{
    initAudioIfNeeded();
    if(!state.audioCtx || !state.masterGain) return;

    if(state.audioCtx.state === "suspended") state.audioCtx.resume();

    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = CONFIG.beepFreqHz;

    const now = ctx.currentTime;
    const g = Math.max(0.0001, CONFIG.beepGain);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(g, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.03, CONFIG.beepDurationMs/1000));

    osc.connect(gain);
    gain.connect(state.masterGain);

    osc.start(now);
    osc.stop(now + Math.max(0.05, CONFIG.beepDurationMs/1000) + 0.02);
  } catch {
    // silencieux
  }
}

// ---- Planifier N bips aléatoires ----
function scheduleRandomBeeps(){
  const n = Number(els.beepCountSelect?.value || 0);
  if(!n || n <= 0) return;

  // On évite les bips tout de suite au départ / tout à la fin
  const margin = 5000;
  const maxT = Math.max(margin + 1000, state.runDurationMs - margin);

  for(let i=0;i<n;i++){
    const t = Math.floor(randBetween(margin, maxT));
    schedule(() => {
      if(!state.running) return;
      const picked = pickBeepGain();
  const old = CONFIG.beepGain;
  CONFIG.beepGain = picked.gain;

  playBeep();

  CONFIG.beepGain = old;
      state.pendingTag = "post_beep"; // appliqué à la PROCHAINE consigne
    }, t);
  }
}

// ---- Présenter une consigne ----
function presentCue(){
  // Si consigne précédente non répondue -> omission
  if(state.currentCue && !state.currentCue.responded){
    const p = state.currentCue;
    state.logs.push({
      trialIndex: p.trialIndex,
      cueLabel: p.cueLabel,
      correctAnswer: p.correct,
      choice: "",
      correct: "",
      rtMs: "",
      cueTimeRelMs: p.cueTimeRelMs,
      minuteBin: Math.floor(p.cueTimeRelMs/60000),
      distractorWindow: p.distractorWindow || "baseline",
      omission: 1
    });
  }

  const label = pickCueLabel();
  updateRunStats(label);

  const cueTimePerf = nowPerf();
  const cueTimeRelMs = Math.round(cueTimePerf - state.startPerf);

  const tag = state.pendingTag || "baseline";
  state.pendingTag = null;

  state.currentCue = {
    trialIndex: state.trialCount,
    cueLabel: label,
    correct: cueToCorrect(label),
    cueTimePerf,
    cueTimeRelMs,
    distractorWindow: tag,
    responded: false
  };

  setCue(`Consigne : ${label}`, "Répondez avec + / −");
speak(label.toLowerCase()); // dit "plus" ou "moins"
schedule(() => setCue("Continuez…", ""), CONFIG.showCueTextMs);


  state.trialCount += 1;
}

// ---- Enchaîner les consignes (ISI variable) ----
function scheduleNextCue(){
  if(!state.running) return;

  const elapsed = nowPerf() - state.startPerf;
  if(elapsed >= state.runDurationMs){
    stopRun();
    return;
  }

  const isi = Math.round(randBetween(CONFIG.minISI, CONFIG.maxISI));
  schedule(() => {
    if(!state.running) return;
    presentCue();
    scheduleNextCue();
  }, isi);
}

// ---- Réponses ----
function handleResponse(choice){
  if(!state.running) return;

  const t = nowPerf();
  if(t - state.lastTapPerf < CONFIG.minInterTapMs) return;
  state.lastTapPerf = t;

  const cue = state.currentCue;
  if(!cue || cue.responded) return;

  cue.responded = true;

  const rtMs = Math.round(t - cue.cueTimePerf);
  const correct = (choice === cue.correct) ? 1 : 0;

  state.logs.push({
    trialIndex: cue.trialIndex,
    cueLabel: cue.cueLabel,
    correctAnswer: cue.correct,
    choice,
    correct,
    rtMs,
    cueTimeRelMs: cue.cueTimeRelMs,
    minuteBin: Math.floor(cue.cueTimeRelMs/60000),
    distractorWindow: cue.distractorWindow || "baseline",
    omission: 0
  });
  flashAcknowledged(choice === "+" ? els.btnPlus : els.btnMinus);

}

function flashAcknowledged(btn){
  const oldBg = btn.style.background;
  const oldBox = btn.style.boxShadow;

  btn.style.background = "rgba(140,255,140,0.95)";
  btn.style.boxShadow = "0 0 0 10px rgba(255,255,255,0.35), 0 12px 28px rgba(0,0,0,0.35)";

  schedule(() => {
    btn.style.background = oldBg || "";
    btn.style.boxShadow = oldBox || "";
  }, 160);
}


// ---- Timer ----
function updateTimer(){
  if(!state.running) return;
  els.timer.textContent = fmtSeconds(nowPerf() - state.startPerf);
  state.rafId = requestAnimationFrame(updateTimer);
}

// ---- Run control ----
function startRun(){
  if(state.running) return;

  clearScheduled();

  state.logs = [];
  state.trialCount = 0;
  state.currentCue = null;
  state.lastCueLabel = null;
  state.lastRunLength = 0;
  state.pendingTag = null;
  state.lastTapPerf = 0;

  state.runDurationMs = Number(els.durationSelect?.value || 600000);

  // init audio after gesture
  initAudioIfNeeded();

  state.running = true;
  setStatus("En cours");

  els.downloadBtn.disabled = true;
  els.resetBtn.disabled = false;

  state.startPerf = nowPerf();
  els.timer.textContent = "00.0s";
  updateTimer();

  // ⭐ planifier N bips
  scheduleRandomBeeps();

  // démarrer consignes
  presentCue();
  scheduleNextCue();

  // fin dure
  schedule(() => stopRun(), state.runDurationMs);
}

function stopRun(){
  if(!state.running) return;
  state.running = false;
  clearScheduled();

  // omission finale si dernière consigne non répondue
  if(state.currentCue && !state.currentCue.responded){
    const p = state.currentCue;
    state.logs.push({
      trialIndex: p.trialIndex,
      cueLabel: p.cueLabel,
      correctAnswer: p.correct,
      choice: "",
      correct: "",
      rtMs: "",
      cueTimeRelMs: p.cueTimeRelMs,
      minuteBin: Math.floor(p.cueTimeRelMs/60000),
      distractorWindow: p.distractorWindow || "baseline",
      omission: 1
    });
  }

  setStatus("Terminé");
  setCue("Terminé.", "Téléchargez le CSV.");
  els.downloadBtn.disabled = false;
  els.resetBtn.disabled = false;
}

function resetAll(){
  clearScheduled();
  state.running = false;
  state.logs = [];
  state.trialCount = 0;
  state.currentCue = null;
  state.pendingTag = null;

  setStatus("Prêt");
  els.timer.textContent = "00.0s";
  setCue("Appuie sur + quand j'ai dit PLUS, et sur − quand j'ai dit MOINS.", "Choisissez une durée et un nombre de bips puis démarrez.");
  els.downloadBtn.disabled = true;
  els.resetBtn.disabled = true;
}

// ---- Export CSV ----
function exportCSV(){
  const header = [
    "trialIndex","cueLabel","correctAnswer","choice","correct",
    "rtMs","cueTimeRelMs","minuteBin","distractorWindow","omission"
  ];

  const rows = [header.join(",")];

  for(const r of state.logs){
    rows.push([
      r.trialIndex ?? "",
      r.cueLabel ?? "",
      r.correctAnswer ?? "",
      r.choice ?? "",
      r.correct ?? "",
      r.rtMs ?? "",
      r.cueTimeRelMs ?? "",
      r.minuteBin ?? "",
      r.distractorWindow ?? "",
      r.omission ?? ""
    ].join(","));
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attention2_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- UI binding ----
function bindUI(){
  els.btnPlus.addEventListener("click", () => {
    if(!state.running) { startRun(); return; }
    handleResponse("+");
  });

  els.btnMinus.addEventListener("click", () => {
    if(!state.running) { startRun(); return; }
    handleResponse("-");
  });

  els.startBtn.addEventListener("click", startRun);
  els.downloadBtn.addEventListener("click", exportCSV);
  els.resetBtn.addEventListener("click", resetAll);

  document.addEventListener("pointerdown", (e) => {
    if (e.target === els.downloadBtn || e.target === els.resetBtn || e.target === els.durationSelect || e.target === els.beepCountSelect) return;
    if (!state.running) startRun();
  }, { passive: true });
}

(function main(){
  bindUI();
  resetAll();
})();
