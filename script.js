// attention2 – durée variable + séquence aléatoire (type + timing)
// + distracteur auditif (bips aléatoires) = capture attentionnelle exogène
// Objectif: attention soutenue + coût distracteurs + lapses (omissions)

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
  spriteStudent: document.getElementById("spriteStudent"),
  spriteBird: document.getElementById("spriteBird"),
  spriteDoor: document.getElementById("spriteDoor"),
};

const CONFIG = {
  // Timing des essais (random)
  minISI: 2200,        // ms (délai min entre consignes)
  maxISI: 4200,        // ms (délai max)
  pPlus: 0.5,          // proba de PLUS
  avoidLongRuns: true, // éviter trop de répétitions identiques
  maxRunLength: 3,

  // Audio (consignes)
  useSpeechSynthesis: true,
  speechLang: "fr-FR",
  showCueTextMs: 700,

  // Réponse
  minInterTapMs: 120,

  // Distracteurs VISUELS (facultatifs) – probabilistes
  // (si sprites absents, pas grave: ça ne plante pas)
  distractorCheckEveryMs: 15000, // toutes les 15s, opportunité
  pStudentTurn: 0.25,
  pBirdLand: 0.20,
  pDoorOpen: 0.15,
  distractorDurationMs: 1200,

  // Distracteur AUDITIF (bip) – capture attentionnelle
  // Fenêtre régulière + tirage probabiliste (simple et efficace)
  beepCheckEveryMs: 12000,  // toutes les 12s, opportunité
  pBeep: 0.35,              // proba de bip à chaque fenêtre
  beepDurationMs: 180,      // durée bip (ms)
  beepFreqHz: 880,          // fréquence bip (Hz)
  beepGain: 0.10            // volume (0.05 à 0.15 conseillé)
};

const state = {
  running: false,
  startPerf: 0,
  runDurationMs: 600000,
  rafId: null,
  timeouts: [],
  lastTapPerf: 0,

  // Essais
  trialCount: 0,
  currentCue: null,
  lastCueLabel: null,
  lastRunLength: 0,

  // Distracteurs: tag appliqué à la prochaine consigne
  pendingDistractorTag: null,

  // Logs
  logs: [],
};

function nowPerf() { return performance.now(); }

function schedule(fn, delayMs) {
  const id = setTimeout(fn, delayMs);
  state.timeouts.push(id);
}

function clearScheduled() {
  for (const id of state.timeouts) clearTimeout(id);
  state.timeouts = [];
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
}

function fmtSeconds(ms) {
  const s = ms / 1000;
  return s.toFixed(1).padStart(4, "0") + "s";
}

function setStatus(txt) { els.status.textContent = txt; }

function setCue(main, sub="") {
  els.cueLabel.textContent = main;
  els.cueSub.textContent = sub;
}

function speak(text) {
  if (!CONFIG.useSpeechSynthesis) return;
  if (!("speechSynthesis" in window)) return;

  // Sur certains Android, la synthèse peut couper: on reste simple.
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = CONFIG.speechLang;
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 1.0;
  window.speechSynthesis.speak(u);
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickCueLabel() {
  let label = (Math.random() < CONFIG.pPlus) ? "PLUS" : "MOINS";

  if (CONFIG.avoidLongRuns && state.trialCount >= 1) {
    const last = state.lastCueLabel;
    const runLen = state.lastRunLength || 1;

    if (label === last && runLen >= CONFIG.maxRunLength) {
      label = (last === "PLUS") ? "MOINS" : "PLUS";
    }
  }
  return label;
}

function updateRunStats(newLabel) {
  if (newLabel === state.lastCueLabel) {
    state.lastRunLength = (state.lastRunLength || 1) + 1;
  } else {
    state.lastRunLength = 1;
    state.lastCueLabel = newLabel;
  }
}

function cueToCorrect(label) {
  return (label === "PLUS") ? "+" : "-";
}

// --- Sprites distracteurs (facultatifs) ---
function showSprite(el, className, durationMs){
  if (!el) return;
  el.classList.remove("show", "birdLanding", "doorOpening");
  void el.offsetWidth; // reflow
  if (className) el.classList.add(className);
  el.classList.add("show");
  schedule(() => el.classList.remove("show", "birdLanding", "doorOpening"), durationMs);
}

function maybeTriggerVisualDistractor() {
  const dur = CONFIG.distractorDurationMs;

  // Si pas de fichier image, l'élément existe quand même mais peut être cassé visuellement.
  // Ce n'est pas grave. Vous pourrez uploader les sprites plus tard.
  const r = Math.random();

  if (r < CONFIG.pStudentTurn) {
    showSprite(els.spriteStudent, null, dur);
    return "student_turn";
  }
  if (r < CONFIG.pStudentTurn + CONFIG.pBirdLand) {
    showSprite(els.spriteBird, "birdLanding", dur);
    return "bird_land";
  }
  if (r < CONFIG.pStudentTurn + CONFIG.pBirdLand + CONFIG.pDoorOpen) {
    showSprite(els.spriteDoor, "doorOpening", dur);
    return "door_open";
  }
  return null;
}

// --- Bip auditif (capture exogène) ---
function playBeep(durationMs, freqHz, gainVal) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = freqHz;

    // petite enveloppe pour éviter le "click"
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainVal), now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, durationMs / 1000));

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, durationMs + 30);
  } catch {
    // Après un premier tap, ça marche généralement.
  }
}

function flashButton(btn, isCorrect) {
  const oldBg = btn.style.background;
  const oldBox = btn.style.boxShadow;

  btn.style.background = isCorrect ? "rgba(140,255,140,0.95)" : "rgba(255,140,140,0.95)";
  btn.style.boxShadow = "0 0 0 10px rgba(255,255,255,0.35), 0 12px 28px rgba(0,0,0,0.35)";

  schedule(() => {
    btn.style.background = oldBg || "rgba(255,255,255,0.85)";
    btn.style.boxShadow = oldBox || "";
  }, 240);
}

// --- Coeur du moteur ---
function presentCue() {
  // Loguer omission si la consigne précédente n'a pas été répondue
  if (state.currentCue && !state.currentCue.responded) {
    const prev = state.currentCue;
    state.logs.push({
      trialIndex: prev.trialIndex,
      cueLabel: prev.cueLabel,
      correctAnswer: prev.correct,
      choice: "",
      correct: "",
      rtMs: "",
      cueTimeRelMs: prev.cueTimeRelMs,
      minuteBin: Math.floor(prev.cueTimeRelMs / 60000),
      distractorWindow: prev.distractorWindow || "baseline",
      omission: 1
    });
  }

  const label = pickCueLabel();
  updateRunStats(label);

  const cueTimePerf = nowPerf();
  const cueTimeRelMs = Math.round(cueTimePerf - state.startPerf);

  // Tag distracteur appliqué à CETTE consigne (s'il y en a un)
  const distractorWindow = state.pendingDistractorTag || "baseline";
  state.pendingDistractorTag = null;

  state.currentCue = {
    trialIndex: state.trialCount,
    cueLabel: label,
    correct: cueToCorrect(label),
    cueTimePerf,
    cueTimeRelMs,
    distractorWindow,
    responded: false
  };

  setCue(`Consigne : ${label}`, "Répondez avec + / −");
  speak(label.toLowerCase());

  schedule(() => setCue("Continuez…", ""), CONFIG.showCueTextMs);

  state.trialCount += 1;
}

function scheduleNextCue() {
  if (!state.running) return;

  const elapsed = nowPerf() - state.startPerf;
  if (elapsed >= state.runDurationMs) {
    stopRun();
    return;
  }

  const isi = Math.round(randBetween(CONFIG.minISI, CONFIG.maxISI));
  schedule(() => {
    if (!state.running) return;
    presentCue();
    scheduleNextCue();
  }, isi);
}

function scheduleVisualDistractorChecks() {
  function tick() {
    if (!state.running) return;

    const elapsed = nowPerf() - state.startPerf;
    if (elapsed >= state.runDurationMs) return;

    const tag = maybeTriggerVisualDistractor();
    if (tag) {
      // marquer la prochaine consigne comme post_* (effet différé)
      state.pendingDistractorTag = `post_${tag}`;
    }

    schedule(tick, CONFIG.distractorCheckEveryMs);
  }
  schedule(tick, CONFIG.distractorCheckEveryMs);
}

function scheduleBeepChecks() {
  function tick() {
    if (!state.running) return;

    const elapsed = nowPerf() - state.startPerf;
    if (elapsed >= state.runDurationMs) return;

    if (Math.random() < CONFIG.pBeep) {
      playBeep(CONFIG.beepDurationMs, CONFIG.beepFreqHz, CONFIG.beepGain);

      // marquer la prochaine consigne comme post_beep
      state.pendingDistractorTag = "post_beep";
    }

    schedule(tick, CONFIG.beepCheckEveryMs);
  }
  schedule(tick, CONFIG.beepCheckEveryMs);
}

function handleResponse(choice) {
  if (!state.running) return;

  const tPerf = nowPerf();
  if (tPerf - state.lastTapPerf < CONFIG.minInterTapMs) return;
  state.lastTapPerf = tPerf;

  const cue = state.currentCue;
  if (!cue) return;
  if (cue.responded) return;
  cue.responded = true;

  const rtMs = Math.round(tPerf - cue.cueTimePerf);
  const correct = (choice === cue.correct) ? 1 : 0;

  state.logs.push({
    trialIndex: cue.trialIndex,
    cueLabel: cue.cueLabel,
    correctAnswer: cue.correct,
    choice,
    correct,
    rtMs,
    cueTimeRelMs: cue.cueTimeRelMs,
    minuteBin: Math.floor(cue.cueTimeRelMs / 60000),
    distractorWindow: cue.distractorWindow || "baseline",
    omission: 0
  });

  flashButton(choice === "+" ? els.btnPlus : els.btnMinus, correct);
}

function updateTimer() {
  if (!state.running) return;
  const elapsed = nowPerf() - state.startPerf;
  els.timer.textContent = fmtSeconds(elapsed);
  if (elapsed < state.runDurationMs) {
    state.rafId = requestAnimationFrame(updateTimer);
  }
}

function startRun() {
  if (state.running) return;

  clearScheduled();
  state.logs = [];
  state.trialCount = 0;
  state.currentCue = null;
  state.lastCueLabel = null;
  state.lastRunLength = 0;
  state.pendingDistractorTag = null;

  state.runDurationMs = Number(els.durationSelect?.value || 600000);

  state.running = true;
  setStatus("En cours");
  setCue("Regardez la maîtresse…", "Répondez vite et juste (+ / −).");

  els.downloadBtn.disabled = true;
  els.resetBtn.disabled = false;

  // Démarrage temps
  state.startPerf = nowPerf();
  els.timer.textContent = "00.0s";
  updateTimer();

  // Première consigne tout de suite, puis rythme aléatoire
  presentCue();
  scheduleNextCue();

  // Distracteurs (facultatifs)
  scheduleVisualDistractorChecks();
  scheduleBeepChecks();

  // Fin dure (sécurité)
  schedule(() => stopRun(), state.runDurationMs);
}

function stopRun() {
  if (!state.running) return;
  state.running = false;
  clearScheduled();

  // Loguer omission finale si dernière consigne non répondue
  if (state.currentCue && !state.currentCue.responded) {
    const prev = state.currentCue;
    state.logs.push({
      trialIndex: prev.trialIndex,
      cueLabel: prev.cueLabel,
      correctAnswer: prev.correct,
      choice: "",
      correct: "",
      rtMs: "",
      cueTimeRelMs: prev.cueTimeRelMs,
      minuteBin: Math.floor(prev.cueTimeRelMs / 60000),
      distractorWindow: prev.distractorWindow || "baseline",
      omission: 1
    });
  }

  setStatus("Terminé");
  setCue("Terminé.", "Téléchargez le CSV.");
  els.downloadBtn.disabled = false;
  els.resetBtn.disabled = false;

  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function resetAll() {
  clearScheduled();
  state.running = false;
  state.logs = [];
  state.trialCount = 0;
  state.currentCue = null;
  state.pendingDistractorTag = null;

  setStatus("Prêt");
  els.timer.textContent = "00.0s";
  setCue("Appuie sur + quand j'ai dit PLUS, et sur − quand j'ai dit MOINS.", "Choisissez une durée puis touchez l’écran pour démarrer.");
  els.downloadBtn.disabled = true;
  els.resetBtn.disabled = true;
}

function exportCSV() {
  const rows = [];
  rows.push([
    "trialIndex",
    "cueLabel",
    "correctAnswer",
    "choice",
    "correct",
    "rtMs",
    "cueTimeRelMs",
    "minuteBin",
    "distractorWindow",
    "omission"
  ].join(","));

  for (const r of state.logs) {
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

function bindUI() {
  els.btnPlus.addEventListener("click", () => {
    if (!state.running) { startRun(); return; }
    handleResponse("+");
  });

  els.btnMinus.addEventListener("click", () => {
    if (!state.running) { startRun(); return; }
    handleResponse("-");
  });

  els.startBtn.addEventListener("click", startRun);
  els.downloadBtn.addEventListener("click", exportCSV);
  els.resetBtn.addEventListener("click", resetAll);

  // Tap anywhere to start
  document.addEventListener("pointerdown", (e) => {
    if (e.target === els.downloadBtn || e.target === els.resetBtn || e.target === els.durationSelect) return;
    if (!state.running) startRun();
  }, { passive: true });
}

(function main(){
  bindUI();
  resetAll();
})();
