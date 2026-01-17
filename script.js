// attention2 – STABLE (FULL CLEAN)
// - Durée variable (durationSelect)
// - Nombre de bips choisi avant démarrage (beepCountSelect)
// - Mode bip: fixe vs random3 (beepMode + beepLow/Mid/High)
// - Bips planifiés à des instants aléatoires
// - PLUS/MOINS aléatoire + ISI variable
// - Voix: "plus" / "moins"
// - Feedback d'appui: flash vert (sans info juste/faux)
// - Logging complet CSV + colonnes beepLevel/beepRaw/beepGainUsed/beepTimeRelMs

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

  // Optionnel: slider volume fixe (si présent)
  beepVolume: document.getElementById("beepVolume"),
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
  beepGain: 0.16, // valeur par défaut (sera surchargée temporairement au bip)
};

const state = {
  running: false,
  finished: false, // vrai après la fin : verrouille la session,
  startPerf: 0,
  runDurationMs: 600000,

  rafId: null,
  timeouts: [],

  lastTapPerf: 0,

  trialCount: 0,
  currentCue: null,
  lastCueLabel: null,
  lastRunLength: 0,

  pendingTag: null, // "post_beep" appliqué à la prochaine consigne
  logs: [],

  lastBeep: null, // { level, raw, gain, timeRelMs }

  // AudioContext unique
  audioCtx: null,
  masterGain: null,
};

// ---------------- Utils ----------------
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

function fmtSeconds(ms){
  return (ms/1000).toFixed(1).padStart(4, "0") + "s";
}

function setStatus(t){
  if(els.status) els.status.textContent = t;
}

function setCue(a,b=""){
  if(els.cueLabel) els.cueLabel.textContent = a;
  if(els.cueSub) els.cueSub.textContent = b;
}

function randBetween(a,b){ return a + Math.random()*(b-a); }

// ---------------- Speech ----------------
function speak(text){
  if(!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 1.0;
  window.speechSynthesis.speak(u);
}

// ---------------- Beep volume selection ----------------
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

  // Mode fixe: slider beepVolume si présent, sinon 35
  const vFixed = Number(els.beepVolume?.value ?? 35);
  return { gain: sliderToGain(vFixed), level: "fixed", raw: vFixed };
}

// ---------------- Random PLUS/MOINS ----------------
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

// ---------------- Audio (beep) ----------------
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

// ---------------- Schedule random beeps ----------------
function scheduleRandomBeeps(){
  const n = Number(els.beepCountSelect?.value || 0);
  if(!n || n <= 0) return;

  const margin = 5000;
  const maxT = Math.max(margin + 1000, state.runDurationMs - margin);

  for(let i=0; i<n; i++){
    const t = Math.floor(randBetween(margin, maxT));

    schedule(() => {
      if(!state.running) return;

      const picked = pickBeepGain();

      // appliquer temporairement le gain
      const old = CONFIG.beepGain;
      CONFIG.beepGain = picked.gain;
      playBeep();
      CONFIG.beepGain = old;

      state.pendingTag = "post_beep";

      // mémoriser le bip pour la prochaine consigne
      state.lastBeep = {
        level: picked.level,
        raw: picked.raw,
        gain: picked.gain,
        timeRelMs: t,
      };
    }, t);
  }
}

// ---------------- Cue presentation ----------------
function logOmissionFromCue(p){
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
    omission: 1,

    beepLevel: p.beepLevel ?? "",
    beepRaw: p.beepRaw ?? "",
    beepGainUsed: p.beepGainUsed ?? "",
    beepTimeRelMs: p.beepTimeRelMs ?? ""
  });
}

function presentCue(){
  // omission si précédente non répondue
  if(state.currentCue && !state.currentCue.responded){
    logOmissionFromCue(state.currentCue);
  }

  const label = pickCueLabel();
  updateRunStats(label);

  const cueTimePerf = nowPerf();
  const cueTimeRelMs = Math.round(cueTimePerf - state.startPerf);

  const tag = state.pendingTag || "baseline";
  state.pendingTag = null;

  let beepLevel = "";
  let beepRaw = "";
  let beepGainUsed = "";
  let beepTimeRelMs = "";

  if(tag === "post_beep" && state.lastBeep){
    beepLevel = state.lastBeep.level;
    beepRaw = state.lastBeep.raw;
    beepGainUsed = state.lastBeep.gain;
    beepTimeRelMs = state.lastBeep.timeRelMs;
  }

  state.currentCue = {
    trialIndex: state.trialCount,
    cueLabel: label,
    correct: cueToCorrect(label),
    cueTimePerf,
    cueTimeRelMs,
    distractorWindow: tag,
    responded: false,

    beepLevel,
    beepRaw,
    beepGainUsed,
    beepTimeRelMs
  };

  setCue(`Consigne : ${label}`, "Répondez avec + / −");
  speak(label.toLowerCase());
  schedule(() => setCue("Continuez…", ""), CONFIG.showCueTextMs);

  state.trialCount += 1;
}

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

// ---------------- Responses + feedback ----------------
function flashAcknowledged(btn){
  if(!btn) return;
  const oldBg = btn.style.background;
  const oldBox = btn.style.boxShadow;

  btn.style.background = "rgba(140,255,140,0.95)";
  btn.style.boxShadow = "0 0 0 10px rgba(255,255,255,0.35), 0 12px 28px rgba(0,0,0,0.35)";

  schedule(() => {
    btn.style.background = oldBg || "";
    btn.style.boxShadow = oldBox || "";
  }, 160);
}

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
    omission: 0,

    beepLevel: cue.beepLevel ?? "",
    beepRaw: cue.beepRaw ?? "",
    beepGainUsed: cue.beepGainUsed ?? "",
    beepTimeRelMs: cue.beepTimeRelMs ?? ""
  });

  flashAcknowledged(choice === "+" ? els.btnPlus : els.btnMinus);
}

// ---------------- Timer ----------------
function updateTimer(){
  if(!state.running) return;
  if(els.timer) els.timer.textContent = fmtSeconds(nowPerf() - state.startPerf);
  state.rafId = requestAnimationFrame(updateTimer);
}

// ---------------- Run control ----------------
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
  state.lastBeep = null;

  state.runDurationMs = Number(els.durationSelect?.value || 600000);

  initAudioIfNeeded();

  state.running = true;
  setStatus("En cours");

  if(els.downloadBtn) els.downloadBtn.disabled = true;
  if(els.resetBtn) els.resetBtn.disabled = false;

  state.startPerf = nowPerf();
  if(els.timer) els.timer.textContent = "00.0s";
  updateTimer();

  scheduleRandomBeeps();

  presentCue();
  scheduleNextCue();

  schedule(() => stopRun(), state.runDurationMs);
}

function stopRun(){
  if(!state.running) return;
  state.running = false;
  clearScheduled();

  if(state.currentCue && !state.currentCue.responded){
    logOmissionFromCue(state.currentCue);
  }

  setStatus("Terminé");
  setCue("Terminé.", "Téléchargez le CSV.");
  if(els.downloadBtn) els.downloadBtn.disabled = false;
  if(els.resetBtn) els.resetBtn.disabled = false;
}

function resetAll(){
  clearScheduled();
  state.running = false;
  state.logs = [];
  state.trialCount = 0;
  state.currentCue = null;
  state.pendingTag = null;
  state.lastBeep = null;

  setStatus("Prêt");
  if(els.timer) els.timer.textContent = "00.0s";
  setCue(
    "Appuie sur + quand j'ai dit PLUS, et sur − quand j'ai dit MOINS.",
    "Choisissez une durée et un nombre de bips puis démarrez."
  );

  if(els.downloadBtn) els.downloadBtn.disabled = true;
  if(els.resetBtn) els.resetBtn.disabled = true;
}

// ---------------- Export CSV ----------------
function exportCSV(){
  const header = [
    "trialIndex","cueLabel","correctAnswer","choice","correct",
    "rtMs","cueTimeRelMs","minuteBin","distractorWindow","omission",
    "beepLevel","beepRaw","beepGainUsed","beepTimeRelMs"
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
      r.omission ?? "",
      r.beepLevel ?? "",
      r.beepRaw ?? "",
      r.beepGainUsed ?? "",
      r.beepTimeRelMs ?? ""
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

// ---------------- UI binding ----------------
function bindUI(){
  // sécurisation si un élément manque
  els.btnPlus && els.btnPlus.addEventListener("click", () => {
    if(!state.running) { startRun(); return; }
    handleResponse("+");
  });

  els.btnMinus && els.btnMinus.addEventListener("click", () => {
    if(!state.running) { startRun(); return; }
    handleResponse("-");
  });

  els.startBtn && els.startBtn.addEventListener("click", startRun);
  els.downloadBtn && els.downloadBtn.addEventListener("click", exportCSV);
  els.resetBtn && els.resetBtn.addEventListener("click", resetAll);

  document.addEventListener("pointerdown", (e) => {
    if (e.target === els.downloadBtn || e.target === els.resetBtn || e.target === els.durationSelect || e.target === els.beepCountSelect) return;
    if (!state.running) startRun();
  }, { passive: true });
}

(function main(){
  bindUI();
  resetAll();
})();
