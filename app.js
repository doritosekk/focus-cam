// ================== CONFIG (edit these) ==================
const MODEL_URL = "https://teachablemachine.withgoogle.com/models/zICFvNINw/";

// Name of your "paying attention" class exactly as in Teachable Machine.
// Leave null to just use the FIRST class.
const ATTENTIVE_LABEL = null;

const THRESHOLD = 0.7;        // probability needed to count as focused
const DISTRACT_DELAY = 1.5;   // seconds of not-focused before it counts as a distraction
// =========================================================

const $ = (id) => document.getElementById(id);
const el = {
  toggleBtn: $("toggleBtn"), cam: $("webcam-container"), placeholder: $("placeholder"),
  statusText: $("statusText"), scoreText: $("scoreText"), scoreFill: $("scoreFill"),
  sessionTime: $("sessionTime"), focusTime: $("focusTime"), streak: $("streak"),
  bestStreak: $("bestStreak"), distractions: $("distractions"),
  labels: $("label-container"), sound: $("soundToggle"),
};

let model, webcam, maxPredictions, running = false;
let rows = [], attentiveIndex = 0;
let score = 0, lastTime = 0;
let session = 0, focused = 0, streak = 0, best = 0, distractions = 0;
let unfocusedFor = 0, alerted = false;

const fmt = (s) => {
  s = Math.floor(s);
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};

function setState(state, text) {
  document.body.dataset.state = state;
  el.statusText.textContent = text;
}

// ---- ALARM SOUND ----
const ALARM_REPEAT = 2.0; // seconds between alarm bursts while still distracted
let audioCtx = null;
let sinceAlarm = 0;

// call from a click so the browser allows audio
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// loud two-tone siren: 6 quick switches between high and low pitch
function beep() {
  if (!el.sound.checked) return;
  try {
    const ctx = getAudio();
    const t0 = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = 0.6; // volume (0 - 1), raise for louder
    gain.connect(ctx.destination);
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      osc.type = "square"; // harsh, cuts through noise
      osc.frequency.value = i % 2 === 0 ? 960 : 640;
      osc.connect(gain);
      osc.start(t0 + i * 0.18);
      osc.stop(t0 + i * 0.18 + 0.16);
    }
  } catch (e) { /* audio not available, ignore */ }
}

async function start() {
  el.toggleBtn.disabled = true;
  el.toggleBtn.textContent = "Loading...";
  try {
    if (!model) {
      model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
      maxPredictions = model.getTotalClasses();
      const names = model.getClassLabels();
      if (ATTENTIVE_LABEL) {
        const i = names.findIndex((n) => n.toLowerCase() === ATTENTIVE_LABEL.toLowerCase());
        attentiveIndex = i >= 0 ? i : 0;
      }
      el.labels.innerHTML = "";
      rows = names.map((name) => {
        const row = document.createElement("div");
        row.className = "pred-row";
        row.innerHTML = `<div class="top"><span>${name}</span><span>0%</span></div>
                         <div class="track"><div class="fill"></div></div>`;
        el.labels.appendChild(row);
        return row;
      });
    }

    webcam = new tmImage.Webcam(220, 220, true);
    await webcam.setup();
    await webcam.play();
    el.placeholder.remove?.();
    el.cam.appendChild(webcam.canvas);

    session = focused = streak = best = distractions = 0;
    unfocusedFor = 0; alerted = false; score = 0;
    lastTime = performance.now();
    running = true;
    el.toggleBtn.textContent = "Stop";
    setState("running", "Analyzing...");
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setState("idle", "Camera blocked or model failed to load");
    el.toggleBtn.textContent = "Start";
  } finally {
    el.toggleBtn.disabled = false;
  }
}

function stop() {
  running = false;
  document.body.dataset.alarm = "off";
  webcam?.stop();
  webcam?.canvas?.remove();
  el.toggleBtn.textContent = "Start";
  setState("idle", "Stopped");
}

async function loop(now) {
  if (!running) return;
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  webcam.update();
  const prediction = await model.predict(webcam.canvas);

  prediction.forEach((p, i) => {
    const pct = Math.round(p.probability * 100);
    rows[i].querySelector(".top span:last-child").textContent = pct + "%";
    rows[i].querySelector(".fill").style.width = pct + "%";
  });

  const p = prediction[attentiveIndex].probability;
  const isFocused = p >= THRESHOLD;

  // smoothed score so the bar doesn't jitter
  score += (p - score) * 0.15;
  el.scoreText.textContent = Math.round(score * 100) + "%";
  el.scoreFill.style.width = score * 100 + "%";

  session += dt;
  if (isFocused) {
    focused += dt; streak += dt; unfocusedFor = 0; alerted = false; sinceAlarm = 0;
    best = Math.max(best, streak);
    document.body.dataset.alarm = "off";
    setState("focused", "SAFE - Operator attentive");
  } else {
    streak = 0; unfocusedFor += dt;
    setState("distracted", "Warning - Eyes on task");
    if (unfocusedFor >= DISTRACT_DELAY) {
      document.body.dataset.alarm = "on";
      if (!alerted) { alerted = true; distractions++; sinceAlarm = 0; beep(); }
      else {
        sinceAlarm += dt;
        if (sinceAlarm >= ALARM_REPEAT) { sinceAlarm = 0; beep(); } // keeps sounding until you look back
      }
    }
  }

  el.sessionTime.textContent = fmt(session);
  el.focusTime.textContent = fmt(focused);
  el.streak.textContent = fmt(streak);
  el.bestStreak.textContent = fmt(best);
  el.distractions.textContent = distractions;

  requestAnimationFrame(loop);
}

el.toggleBtn.addEventListener("click", () => {
  getAudio(); // unlock audio on the click
  running ? stop() : start();
});
el.sound.addEventListener("change", () => { if (el.sound.checked) beep(); }); // test sound when enabling
