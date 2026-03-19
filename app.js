/**
 * app.js — Stroke-Rehab Virtual Avatar Speech Training Prototype
 *
 * Architecture note (for future FastAPI integration):
 * --------------------------------------------------
 * All functions marked with API_HOOK can be replaced with real fetch() calls.
 *
 * Current mock endpoints (to be replaced):
 *   POST /api/tts          { text }           → { audio_url, subtitle, viseme_timeline? }
 *   POST /api/asr          { audio_blob }     → { text, confidence }
 *   POST /api/score        { asr_text, expected_keywords, duration_ms }
 *                                             → { score, label, feedback, tip }
 *   POST /api/session/save { session }        → { session_id }
 *
 * Replace the three MOCK_* functions below and remove this comment block.
 */

"use strict";

/* ================================================================
   CONSTANTS & SCENE DATA
   ================================================================ */

const SCENES = [
  {
    id: "supermarket",
    name: "超市购物",
    icon: "🛒",
    turns: [
      {
        robotText: "您好！今天想去超市买什么菜呀？",
        hint: "试着说：白菜、萝卜、土豆……",
        expectedKeywords: ["菜", "买", "白菜", "萝卜", "土豆", "苹果", "鸡蛋", "牛奶"],
      },
      {
        robotText: "好的！那您需要多少斤白菜呢？",
        hint: "试着说：一斤、两斤、半斤……",
        expectedKeywords: ["一", "两", "半", "斤", "公斤", "克", "多少"],
      },
      {
        robotText: "明白了！请问您还需要别的东西吗？",
        hint: "试着说：不用了、谢谢、还要……",
        expectedKeywords: ["不用", "谢谢", "还要", "需要", "就这些", "可以了"],
      },
    ],
  },
  {
    id: "directions",
    name: "问路",
    icon: "🗺️",
    turns: [
      {
        robotText: "请问您想去哪里呀？",
        hint: "试着说：医院、公园、银行、邮局……",
        expectedKeywords: ["医院", "公园", "银行", "邮局", "超市", "药店", "车站", "地铁"],
      },
      {
        robotText: "好的，请直走，然后在红绿灯处右转。您听明白了吗？",
        hint: "试着说：听明白了、知道了、谢谢……",
        expectedKeywords: ["听", "明白", "知道", "谢谢", "好的", "清楚", "了解"],
      },
      {
        robotText: "很好！那您自己能走过去吗？",
        hint: "试着说：能、可以、没问题……",
        expectedKeywords: ["能", "可以", "没问题", "行", "好", "我能", "我会"],
      },
    ],
  },
  {
    id: "home",
    name: "居家对话",
    icon: "🏠",
    turns: [
      {
        robotText: "早上好！今天天气不错，您感觉怎么样？",
        hint: "试着说：很好、还不错、有点累……",
        expectedKeywords: ["好", "不错", "累", "舒服", "开心", "精神", "困", "难受"],
      },
      {
        robotText: "今天想吃什么早饭呀？",
        hint: "试着说：粥、面条、包子、鸡蛋……",
        expectedKeywords: ["粥", "面", "包子", "馒头", "鸡蛋", "稀饭", "豆浆", "牛奶"],
      },
      {
        robotText: "好的！今天有什么想做的活动吗？",
        hint: "试着说：散步、看电视、打电话……",
        expectedKeywords: ["散步", "电视", "电话", "休息", "锻炼", "看书", "音乐", "睡"],
      },
    ],
  },
];

const LS_KEY = "rehab_sessions_v1";
const MAX_RECORD_MS = 10_000; // 10 second recording cap
const AMPLITUDE_SMOOTH = 0.25; // 0..1 low-pass coefficient for mouth animation
const SAMPLE_AUDIO_URL = "assets/robot_sample.wav";

// Map Supabase scene_id values to display names
const SCENE_NAMES = {
  supermarket: "🛒 超市购物",
  directions:  "🗺️ 问路",
  home:        "🏠 居家对话",
};

/* ================================================================
   APP STATE
   ================================================================ */

let state = {
  phase: "idle",         // idle | training | speaking | recording | feedback | done
  sceneIndex: 0,
  turnIndex: 0,
  currentScene: null,
  currentTurn: null,
  sessionId: null,
  sessionTurns: [],
  recordingBlob: null,
  recordingUrl: null,
  recordingDurationMs: 0,
  recordingStartTime: null,
};

// Authentication & cloud-sync state
let authState = {
  user: null,
  cloudSyncEnabled: false,
  modalMode: "login", // "login" | "register"
};

/* ================================================================
   DOM REFERENCES
   ================================================================ */

const $ = (id) => document.getElementById(id);

const dom = {
  subtitleText:       $("subtitle-text"),
  hintText:           $("hint-text"),
  statusBanner:       $("status-banner"),
  statusText:         $("status-text"),
  avatarStatus:       $("avatar-status"),
  mouthOpen:          null, // populated after SVG loads
  sceneDots:          $("scene-dots"),
  feedbackPanel:      $("feedback-panel"),
  scoreCircle:        $("score-circle"),
  scoreNum:           $("score-num"),
  scoreLabel:         $("score-label"),
  feedbackText:       $("feedback-text"),
  feedbackTip:        $("feedback-tip"),
  recIndicator:       $("rec-indicator"),
  recTimer:           $("rec-timer"),
  visualizer:         $("visualizer"),
  // Buttons
  btnStart:           $("btn-start"),
  btnPlayRobot:       $("btn-play-robot"),
  btnRecord:          $("btn-record"),
  btnStop:            $("btn-stop"),
  btnPlayback:        $("btn-playback"),
  btnNext:            $("btn-next"),
  btnRestart:         $("btn-restart"),
  // Data center
  statSessions:       $("stat-sessions"),
  statTurns:          $("stat-turns"),
  statAvgScore:       $("stat-avg-score"),
  historyList:        $("history-list"),
  // Auth UI
  btnAuthOpen:        $("btn-auth-open"),
  btnAuthClose:       $("btn-auth-close"),
  btnLogout:          $("btn-logout"),
  btnSyncNow:         $("btn-sync-now"),
  btnAuthSubmit:      $("btn-auth-submit"),
  btnAuthCancel:      $("btn-auth-cancel"),
  authModal:          $("auth-modal"),
  authLoggedOut:      $("auth-logged-out"),
  authLoggedIn:       $("auth-logged-in"),
  authUserEmail:      $("auth-user-email"),
  authEmailInput:     $("auth-email-input"),
  authPasswordInput:  $("auth-password-input"),
  authModalError:     $("auth-modal-error"),
  authModalTitle:     $("auth-modal-title"),
  tabLogin:           $("tab-login"),
  tabRegister:        $("tab-register"),
};

/* ================================================================
   WEB AUDIO — LIP SYNC ENGINE
   ================================================================ */

let audioCtx = null;
let analyser = null;
let lipSyncRAF = null;
let smoothedAmplitude = 0;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Attach an AnalyserNode to any HTMLAudioElement and start
 * updating the avatar mouth open level in real time.
 *
 * How it works:
 *  1. Create AnalyserNode (FFT size 256).
 *  2. Connect audio element → analyser → destination.
 *  3. Each animation frame: read time-domain data → compute RMS.
 *  4. Apply exponential smoothing to avoid jitter.
 *  5. Map 0..0.3 RMS range → 0..1 open ratio.
 *  6. Set SVG mouth-open ellipse ry (0..14px) accordingly.
 */
function startLipSync(audioEl) {
  stopLipSync();
  const ctx = ensureAudioContext();

  // Safari needs a user gesture before AudioContext can be used
  const source = ctx.createMediaElementSource(audioEl);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;

  source.connect(analyser);
  analyser.connect(ctx.destination);

  const bufferLen = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLen);

  function tick() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(dataArray);

    // RMS calculation
    let sumSq = 0;
    for (let i = 0; i < bufferLen; i++) {
      const norm = (dataArray[i] - 128) / 128;
      sumSq += norm * norm;
    }
    const rms = Math.sqrt(sumSq / bufferLen);

    // Exponential smoothing
    smoothedAmplitude =
      AMPLITUDE_SMOOTH * rms + (1 - AMPLITUDE_SMOOTH) * smoothedAmplitude;

    // Map to mouth opening (ry attribute of ellipse, max 14px)
    const openRatio = Math.min(smoothedAmplitude / 0.3, 1);
    setMouthOpen(openRatio);

    lipSyncRAF = requestAnimationFrame(tick);
  }

  lipSyncRAF = requestAnimationFrame(tick);
}

function stopLipSync() {
  if (lipSyncRAF) {
    cancelAnimationFrame(lipSyncRAF);
    lipSyncRAF = null;
  }
  analyser = null;
  smoothedAmplitude = 0;
  setMouthOpen(0);
}

/** Set mouth open level 0..1 → SVG ry 0..14 */
function setMouthOpen(ratio) {
  const mouth = getMouthEl();
  if (!mouth) return;
  const ry = Math.round(ratio * 14 * 10) / 10;
  mouth.setAttribute("ry", ry);
}

/** Lazily resolve the SVG #mouth-open element (may be in <object> or inline) */
function getMouthEl() {
  if (dom.mouthOpen) return dom.mouthOpen;
  // Try inline SVG first
  dom.mouthOpen = document.getElementById("mouth-open");
  if (dom.mouthOpen) return dom.mouthOpen;
  // Try <object> SVG
  const obj = document.getElementById("avatar-object");
  if (obj && obj.contentDocument) {
    dom.mouthOpen = obj.contentDocument.getElementById("mouth-open");
  }
  return dom.mouthOpen;
}

/* ================================================================
   MEDIA RECORDER — VOICE RECORDING
   ================================================================ */

let mediaRecorder = null;
let recordChunks = [];
let recTimerInterval = null;

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showBanner("danger", "⚠️ 您的浏览器不支持录音功能，请使用 Chrome 或 Safari。");
    return false;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const msg =
      err.name === "NotAllowedError"
        ? "麦克风权限被拒绝，请在浏览器设置中允许麦克风权限后刷新页面。"
        : "无法访问麦克风，请检查设备连接和浏览器权限后重试。";
    showBanner("danger", "⚠️ " + msg);
    return false;
  }

  // Start waveform visualizer from the same stream (no extra getUserMedia)
  startVisualizer(stream);

  recordChunks = [];
  const mimeType = getSupportedMimeType();
  const options = mimeType ? { mimeType } : {};
  mediaRecorder = new MediaRecorder(stream, options);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    finalizeRecording();
  };

  mediaRecorder.start(100); // collect every 100ms

  // Start timer
  state.recordingStartTime = Date.now();
  updateRecTimer();
  recTimerInterval = setInterval(updateRecTimer, 500);

  // Auto-stop after MAX_RECORD_MS
  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    }
  }, MAX_RECORD_MS);

  return true;
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
  clearInterval(recTimerInterval);
}

function finalizeRecording() {
  const mimeType = getSupportedMimeType() || "audio/webm";
  state.recordingBlob = new Blob(recordChunks, { type: mimeType });
  state.recordingDurationMs = Date.now() - state.recordingStartTime;
  state.recordingUrl = URL.createObjectURL(state.recordingBlob);
  state.recordingStartTime = null;
}

function updateRecTimer() {
  if (!state.recordingStartTime) return;
  const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
  dom.recTimer.textContent = `${elapsed}s / ${MAX_RECORD_MS / 1000}s`;
}

function getSupportedMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
}

/* ================================================================
   MOCK API HOOKS
   Replace these three functions with real fetch() calls when
   the FastAPI backend is available.
   ================================================================ */

/**
 * MOCK_ASR — simulate speech recognition
 * Real endpoint: POST /api/asr { audio_blob } → { text, confidence }
 *
 * @param {Blob} audioBlob
 * @param {string[]} expectedKeywords
 * @returns {Promise<{text:string, confidence:number}>}
 */
async function MOCK_ASR(audioBlob, expectedKeywords) {  /* API_HOOK */
  await sleep(800);
  // Pick a random expected keyword as "recognized" text
  const keyword = expectedKeywords[Math.floor(Math.random() * expectedKeywords.length)];
  const confidence = 0.5 + Math.random() * 0.5; // 0.5..1.0
  return { text: keyword, confidence };
}

/**
 * MOCK_SCORE — simulate intelligibility scoring
 * Real endpoint: POST /api/score { asr_text, expected_keywords, duration_ms }
 *              → { score, label, feedback, tip }
 *
 * Scoring formula (matches backend design spec):
 *   score = 100 * (0.5 * conf + 0.4 * hit + 0.1 * pace)
 *   label: ≥80 → clear | 50-79 → fair | <50 → unclear
 *
 * @param {string}   asrText
 * @param {number}   confidence
 * @param {string[]} expectedKeywords
 * @param {number}   durationMs
 * @returns {Promise<{score:number, label:string, feedback:string, tip:string}>}
 */
async function MOCK_SCORE(asrText, confidence, expectedKeywords, durationMs) {  /* API_HOOK */
  await sleep(400);

  // keyword hit rate
  const safeText = typeof asrText === "string" ? asrText : "";
  const asrLower = safeText.toLowerCase();
  const hits = expectedKeywords.filter((k) => asrLower.includes(k)).length;
  const hit = expectedKeywords.length > 0 ? hits / expectedKeywords.length : 0.5;

  // pace: optimal is 1-3 chars/second
  const chars = safeText.length || 1;
  const secs = durationMs / 1000;
  const cps = chars / secs;
  const pace = cps >= 0.5 && cps <= 4 ? 1.0 : cps >= 0.3 ? 0.6 : 0.3;

  // Add a small random jitter (±5%)
  const rawScore = 100 * (0.5 * confidence + 0.4 * hit + 0.1 * pace);
  const jitter = (Math.random() - 0.5) * 10;
  const score = Math.round(Math.max(0, Math.min(100, rawScore + jitter)));

  let label, feedback, tip;
  if (score >= 80) {
    label = "clear";
    feedback = "👏 非常清晰！说得很好！";
    tip = "继续保持，您进步很快！";
  } else if (score >= 50) {
    label = "fair";
    feedback = "👍 还不错，部分词语可以更清楚。";
    tip = "试着放慢语速，每个字说清楚一点。";
  } else {
    label = "unclear";
    feedback = "💪 没关系，我们再练习一次！";
    tip = "深呼吸，慢慢说，每个字都很重要。";
  }

  return { score, label, feedback, tip };
}

/**
 * MOCK_TTS — simulate text-to-speech
 * Real endpoint: POST /api/tts { text } → { audio_url }
 *
 * Returns the bundled sample audio for all prompts (demo only).
 * @returns {Promise<{audio_url:string}>}
 */
async function MOCK_TTS(_text) {  /* API_HOOK */
  return { audio_url: SAMPLE_AUDIO_URL };
}

/* ================================================================
   TRAINING LOOP
   ================================================================ */

function startTraining() {
  state.phase = "training";
  state.sceneIndex = 0;
  state.turnIndex = 0;
  state.sessionTurns = [];
  state.sessionId = "session_" + Date.now();
  state.recordingBlob = null;
  state.recordingUrl = null;

  renderSceneDots();
  hideFeedback();
  setPhaseUI("training");
  advanceTurn();
}

async function advanceTurn() {
  const scene = SCENES[state.sceneIndex];
  const turn  = scene.turns[state.turnIndex];
  state.currentScene = scene;
  state.currentTurn  = turn;

  dom.subtitleText.textContent = turn.robotText;
  dom.hintText.textContent     = turn.hint || "";
  hideFeedback();
  showBanner("info", `📖 场景：${scene.icon} ${scene.name}  |  第 ${state.turnIndex + 1} / ${scene.turns.length} 轮`);
  setPhaseUI("training");

  // Auto-play robot voice
  await playRobotVoice(turn.robotText);
}

async function playRobotVoice(text) {
  state.phase = "speaking";
  setPhaseUI("speaking");
  setAvatarStatus("speaking");

  const { audio_url } = await MOCK_TTS(text);
  await playAudioWithLipSync(audio_url);

  state.phase = "training";
  setPhaseUI("training");
  setAvatarStatus("ready");
}

function playAudioWithLipSync(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";

    // Ensure AudioContext is created on a user gesture; if it fails silently
    // (e.g., on mobile before interaction), fall back to plain play.
    const tryLipSync = () => {
      try {
        ensureAudioContext();
        startLipSync(audio);
      } catch (_) {
        // Ignore — mouth just stays closed
      }
    };

    audio.addEventListener("play", tryLipSync, { once: true });
    audio.addEventListener("ended", () => {
      stopLipSync();
      resolve();
    });
    audio.addEventListener("error", () => {
      stopLipSync();
      showBanner("warning", "⚠️ 示例音频加载失败。请参阅 README 了解如何替换 robot_sample.wav。");
      resolve();
    });

    audio.play().catch(() => {
      stopLipSync();
      resolve();
    });
  });
}

async function handleRecordStart() {
  state.recordingBlob = null;
  state.recordingUrl  = null;

  const ok = await startRecording();
  if (!ok) return;

  state.phase = "recording";
  setPhaseUI("recording");
  setAvatarStatus("listening");
  dom.recIndicator.classList.add("active");
  showBanner("danger", "🎙️ 正在录音…");
}

function handleRecordStop() {
  stopRecording();
  state.phase = "training";
  dom.recIndicator.classList.remove("active");
  setAvatarStatus("ready");
  setPhaseUI("recorded");
  showBanner("info", "✅ 录音完成，可以播放或提交。");
}

function handlePlayback() {
  if (!state.recordingUrl) return;
  const audio = new Audio(state.recordingUrl);
  audio.play().catch(() => {
    showBanner("warning", "⚠️ 无法播放录音。");
  });
}

async function handleNext() {
  if (!state.recordingBlob || !state.recordingUrl) {
    showBanner("warning", "⚠️ 请先录音再继续。");
    return;
  }

  showBanner("info", "⏳ 正在分析您的语音…");
  setPhaseUI("loading");

  const turn = state.currentTurn;

  // Step 1: ASR
  const { text: asrText, confidence } = await MOCK_ASR(
    state.recordingBlob,
    turn.expectedKeywords
  );

  // Step 2: Score
  const { score, label, feedback, tip } = await MOCK_SCORE(
    asrText,
    confidence,
    turn.expectedKeywords,
    state.recordingDurationMs
  );

  // Step 3: Save turn record
  const turnRecord = {
    scene_id:     state.currentScene.id,
    scene_name:   state.currentScene.name,
    turn_index:   state.turnIndex,
    robot_text:   turn.robotText,
    asr_text:     asrText,
    confidence:   confidence,
    score:        score,
    label:        label,
    duration_ms:  state.recordingDurationMs,
    timestamp:    new Date().toISOString(),
  };
  state.sessionTurns.push(turnRecord);

  // Step 4: Show feedback
  showFeedback(score, label, feedback, tip);
  state.phase = "feedback";
  setPhaseUI("feedback");

  // Advance pointers
  const scene = SCENES[state.sceneIndex];
  const isLastTurn  = state.turnIndex >= scene.turns.length - 1;
  const isLastScene = state.sceneIndex >= SCENES.length - 1;

  if (isLastTurn && isLastScene) {
    // All done → save session
    state.phase = "done";
    const savedSession = await saveSession();
    setPhaseUI("done");
    showBanner("success", "🎉 训练完成！已保存到数据中心。");
    renderDataCenter();
    // Async cloud sync — do not block UI; warn on failure
    syncSessionToCloud(savedSession).catch(() => {
      showBanner(
        "warning",
        "⚠️ 数据已保存到本地，但云端同步失败，可稍后点击立即同步重试。"
      );
    });
  } else {
    // Move to next turn / scene
    if (isLastTurn) {
      state.sceneIndex++;
      state.turnIndex = 0;
    } else {
      state.turnIndex++;
    }
    renderSceneDots();
    setPhaseUI("feedback"); // keep "Next" visible
  }

  // Reset recording
  state.recordingBlob = null;
  state.recordingUrl  = null;
}

/* ================================================================
   SESSION STORAGE (localStorage)
   ================================================================ */

function saveSession() {
  const turns = state.sessionTurns;
  const avgScore =
    turns.length > 0
      ? Math.round(turns.reduce((s, t) => s + t.score, 0) / turns.length)
      : 0;

  const session = {
    session_id:  state.sessionId,
    timestamp:   new Date().toISOString(),
    scene_names: [...new Set(turns.map((t) => t.scene_name))].join(" / "),
    turn_count:  turns.length,
    avg_score:   avgScore,
    avg_label:   scoreToLabel(avgScore),
    turns:       turns,
  };

  const existing = loadSessions();
  existing.unshift(session);
  // Keep last 50 sessions
  const trimmed = existing.slice(0, 50);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
  } catch (_) {
    showBanner("warning", "⚠️ 无法保存训练记录（浏览器存储空间已满或隐私模式限制）。");
  }
  return Promise.resolve(session);
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

/* ================================================================
   AUTH — INITIALIZATION & STATE MANAGEMENT
   ================================================================ */

async function initAuth() {
  const sb = window.__SUPABASE__;
  if (!sb) return;

  // Restore any persisted session (also handles email-confirm redirect tokens)
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      authState.user             = session.user;
      authState.cloudSyncEnabled = true;
      updateAuthUI();
      renderDataCenter();
    }
  } catch (err) {
    console.warn("[initAuth] Failed to restore session:", err);
  }

  // React to future sign-in / sign-out events
  sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      authState.user             = session.user;
      authState.cloudSyncEnabled = true;
    } else {
      authState.user             = null;
      authState.cloudSyncEnabled = false;
    }
    updateAuthUI();
    if (event === "SIGNED_IN") {
      showBanner("success", "✅ 登录成功！训练数据将自动同步到云端。");
      renderDataCenter();
    } else if (event === "SIGNED_OUT") {
      renderDataCenter();
    }
  });
}

function updateAuthUI() {
  if (authState.user) {
    dom.authLoggedOut.style.display = "none";
    dom.authLoggedIn.style.display  = "";
    dom.authUserEmail.textContent   = authState.user.email || "";
  } else {
    dom.authLoggedOut.style.display = "";
    dom.authLoggedIn.style.display  = "none";
  }
}

/* ================================================================
   AUTH — MODAL
   ================================================================ */

function openAuthModal(mode) {
  authState.modalMode = mode || "login";
  dom.authModal.style.display = "";
  setAuthModalMode(authState.modalMode);
  dom.authEmailInput.value    = "";
  dom.authPasswordInput.value = "";
  dom.authModalError.style.display = "none";
  setTimeout(() => dom.authEmailInput.focus(), 50);
}

function closeAuthModal() {
  dom.authModal.style.display = "none";
}

function setAuthModalMode(mode) {
  authState.modalMode = mode;
  if (mode === "login") {
    dom.authModalTitle.textContent = "账户登录";
    dom.tabLogin.classList.add("active");
    dom.tabLogin.setAttribute("aria-selected", "true");
    dom.tabRegister.classList.remove("active");
    dom.tabRegister.setAttribute("aria-selected", "false");
    dom.btnAuthSubmit.textContent = "登录";
    dom.authPasswordInput.setAttribute("autocomplete", "current-password");
  } else {
    dom.authModalTitle.textContent = "注册新账户";
    dom.tabLogin.classList.remove("active");
    dom.tabLogin.setAttribute("aria-selected", "false");
    dom.tabRegister.classList.add("active");
    dom.tabRegister.setAttribute("aria-selected", "true");
    dom.btnAuthSubmit.textContent = "注册";
    dom.authPasswordInput.setAttribute("autocomplete", "new-password");
  }
}

function showAuthError(msg) {
  dom.authModalError.textContent  = msg;
  dom.authModalError.style.display = "";
}

function translateAuthError(msg) {
  if (!msg) return "操作失败，请重试。";
  if (msg.includes("Invalid login credentials"))    return "邮箱或密码错误，请重试。";
  if (msg.includes("Email not confirmed"))          return "邮箱尚未验证，请查收邮件并点击验证链接后再登录。";
  if (msg.includes("User already registered"))      return "该邮箱已注册，请直接登录。";
  if (msg.includes("Password should be at least"))  return "密码至少需要 6 位。";
  if (msg.includes("Unable to validate email"))     return "邮箱格式不正确，请检查后重试。";
  return msg;
}

/* ================================================================
   AUTH — REGISTER / LOGIN / LOGOUT
   ================================================================ */

async function handleRegister() {
  const sb = window.__SUPABASE__;
  if (!sb) { showAuthError("云端服务未加载，请稍后再试。"); return; }

  const email    = dom.authEmailInput.value.trim();
  const password = dom.authPasswordInput.value;
  if (!email || !password) { showAuthError("请填写邮箱地址和密码。"); return; }

  dom.btnAuthSubmit.disabled    = true;
  dom.btnAuthSubmit.textContent = "注册中…";
  dom.authModalError.style.display = "none";

  const { error } = await sb.auth.signUp({ email, password });

  dom.btnAuthSubmit.disabled    = false;
  dom.btnAuthSubmit.textContent = "注册";

  if (error) { showAuthError(translateAuthError(error.message)); return; }

  closeAuthModal();
  showBanner(
    "success",
    "✅ 注册成功！请查收邮箱中的验证邮件，点击链接完成验证后即可登录。"
  );
}

async function handleLogin() {
  const sb = window.__SUPABASE__;
  if (!sb) { showAuthError("云端服务未加载，请稍后再试。"); return; }

  const email    = dom.authEmailInput.value.trim();
  const password = dom.authPasswordInput.value;
  if (!email || !password) { showAuthError("请填写邮箱地址和密码。"); return; }

  dom.btnAuthSubmit.disabled    = true;
  dom.btnAuthSubmit.textContent = "登录中…";
  dom.authModalError.style.display = "none";

  const { error } = await sb.auth.signInWithPassword({ email, password });

  dom.btnAuthSubmit.disabled    = false;
  dom.btnAuthSubmit.textContent = "登录";

  if (error) { showAuthError(translateAuthError(error.message)); return; }

  closeAuthModal();
  // onAuthStateChange will update UI and call renderDataCenter
}

async function handleLogout() {
  const sb = window.__SUPABASE__;
  if (!sb) return;

  await sb.auth.signOut();
  showBanner("info", "🚪 已退出登录。");
  // onAuthStateChange will update UI and call renderDataCenter
}

/* ================================================================
   CLOUD SYNC
   ================================================================ */

/**
 * Sync one local session to Supabase (append-only).
 * Returns true on success, false on failure or if not applicable.
 */
async function syncSessionToCloud(localSession) {
  if (!authState.cloudSyncEnabled || !authState.user) return false;
  if (!localSession || localSession.cloud_synced)      return true;

  const sb = window.__SUPABASE__;
  if (!sb) return false;

  try {
    // Determine primary scene_id from first turn
    const firstTurn = localSession.turns && localSession.turns[0];
    const scene_id  = firstTurn
      ? firstTurn.scene_id
      : (localSession.scene_names || "unknown");

    // Insert the session row
    const { data: cloudSession, error: sessionError } = await sb
      .from("sessions")
      .insert({
        user_id:     authState.user.id,
        scene_id:    scene_id,
        started_at:  localSession.timestamp,
        ended_at:    localSession.timestamp,
        avg_score:   localSession.avg_score,
      })
      .select("id")
      .single();

    if (sessionError) throw sessionError;

    // Insert turn rows
    if (localSession.turns && localSession.turns.length > 0) {
      const turnsPayload = localSession.turns.map((t) => ({
        user_id:      authState.user.id,
        session_id:   cloudSession.id,
        robot_text:   t.robot_text  || "",
        recording_ms: t.duration_ms || 0,
        score:        t.score       || 0,
        label:        t.label       || "unclear",
      }));

      const { error: turnsError } = await sb.from("turns").insert(turnsPayload);
      if (turnsError) throw turnsError;
    }

    // Mark as synced in localStorage
    markSessionAsSynced(localSession.session_id);
    return true;
  } catch (err) {
    console.warn("[syncSessionToCloud] Failed:", err);
    return false;
  }
}

/** Stamp a local session record with cloud_synced: true */
function markSessionAsSynced(sessionId) {
  try {
    const sessions = loadSessions();
    const updated  = sessions.map((s) =>
      s.session_id === sessionId ? Object.assign({}, s, { cloud_synced: true }) : s
    );
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("[markSessionAsSynced] Failed to update localStorage:", err);
  }
}

/**
 * Sync all un-synced local sessions to the cloud (invoked by Sync Now button).
 */
async function syncAllLocalToCloud() {
  if (!authState.cloudSyncEnabled || !authState.user) {
    showBanner("warning", "⚠️ 请先登录才能将数据同步到云端。");
    return;
  }

  const sessions = loadSessions();
  const unsynced  = sessions.filter((s) => !s.cloud_synced);

  if (unsynced.length === 0) {
    showBanner("success", "✅ 所有本地数据已同步到云端。");
    return;
  }

  showBanner("info", `☁️ 正在同步 ${unsynced.length} 条记录，请稍候…`);

  let successCount = 0;
  for (const session of unsynced) {
    const ok = await syncSessionToCloud(session);
    if (ok) successCount++;
  }

  if (successCount === unsynced.length) {
    showBanner("success", `✅ 已成功同步 ${successCount} 条记录到云端。`);
  } else if (successCount > 0) {
    showBanner(
      "warning",
      `⚠️ 部分同步完成：${successCount} / ${unsynced.length} 条成功，请稍后重试。`
    );
  } else {
    showBanner("danger", "❌ 同步失败，请检查网络连接后重试。");
  }

  renderDataCenter();
}

/**
 * Async — prefers cloud data when logged in; falls back to localStorage.
 * Safe to call without await (runs in background and updates DOM when ready).
 */
async function renderDataCenter() {
  if (authState.cloudSyncEnabled && authState.user) {
    const sb = window.__SUPABASE__;
    if (sb) {
      try {
        const { data: cloudSessions, error } = await sb
          .from("sessions")
          .select("id, scene_id, avg_score, created_at")
          .eq("user_id", authState.user.id)
          .order("created_at", { ascending: false })
          .limit(20);

        if (!error && cloudSessions) {
          renderDataCenterCloud(cloudSessions);
          return;
        }
      } catch (err) {
        console.warn("[renderDataCenter] Cloud fetch failed, falling back to localStorage:", err);
        // Fall through to localStorage
      }
    }
  }
  renderDataCenterLocal();
}

function renderDataCenterCloud(cloudSessions) {
  const totalSessions = cloudSessions.length;
  const avgScore =
    totalSessions > 0
      ? Math.round(
          cloudSessions.reduce((s, sess) => s + (Number(sess.avg_score) || 0), 0) /
            totalSessions
        )
      : 0;

  dom.statSessions.textContent  = totalSessions;
  dom.statTurns.textContent     = "--";
  dom.statAvgScore.textContent  = totalSessions > 0 ? avgScore : "--";

  dom.historyList.innerHTML = "";
  if (cloudSessions.length === 0) {
    dom.historyList.innerHTML =
      '<li class="history-empty">暂无云端训练记录。完成一次训练后数据将自动同步。</li>';
    return;
  }

  cloudSessions.forEach((sess) => {
    const li = document.createElement("li");
    li.className = "history-item";

    const score     = Number(sess.avg_score) || 0;
    const label     = scoreToLabel(score);
    const date      = formatDate(sess.created_at);
    const sceneName = SCENE_NAMES[sess.scene_id] || escapeHtml(sess.scene_id || "训练");

    li.innerHTML = `
      <span class="history-score ${label}">${score > 0 ? score : "--"}</span>
      <div class="history-meta">
        <div class="scene-name">${sceneName}</div>
        <div class="time-info">${date}</div>
      </div>
    `;
    dom.historyList.appendChild(li);
  });
}

function renderDataCenterLocal() {
  const sessions = loadSessions();

  const totalSessions = sessions.length;
  const totalTurns    = sessions.reduce((s, sess) => s + (sess.turn_count || 0), 0);
  const avgScore =
    totalSessions > 0
      ? Math.round(
          sessions.reduce((s, sess) => s + (sess.avg_score || 0), 0) / totalSessions
        )
      : 0;

  dom.statSessions.textContent  = totalSessions;
  dom.statTurns.textContent     = totalTurns;
  dom.statAvgScore.textContent  = totalSessions > 0 ? avgScore : "--";

  dom.historyList.innerHTML = "";

  if (sessions.length === 0) {
    dom.historyList.innerHTML =
      '<li class="history-empty">暂无训练记录。开始您的第一次训练吧！</li>';
    return;
  }

  sessions.slice(0, 20).forEach((sess) => {
    const li    = document.createElement("li");
    li.className = "history-item";

    const label = sess.avg_label || scoreToLabel(sess.avg_score || 0);
    const date  = formatDate(sess.timestamp);

    li.innerHTML = `
      <span class="history-score ${label}">${sess.avg_score ?? "--"}</span>
      <div class="history-meta">
        <div class="scene-name">${escapeHtml(sess.scene_names || "训练")}</div>
        <div class="time-info">${date}  ·  ${sess.turn_count} 轮对话</div>
      </div>
    `;
    dom.historyList.appendChild(li);
  });
}

/* ================================================================
   FEEDBACK DISPLAY
   ================================================================ */

function showFeedback(score, label, feedback, tip) {
  dom.feedbackPanel.classList.add("visible");
  dom.scoreCircle.className = `score-circle ${label}`;
  dom.scoreNum.textContent  = score;
  dom.scoreLabel.textContent =
    label === "clear" ? "清晰" : label === "fair" ? "一般" : "需改进";
  dom.feedbackText.textContent = feedback;
  dom.feedbackTip.textContent  = tip;
}

function hideFeedback() {
  dom.feedbackPanel.classList.remove("visible");
}

/* ================================================================
   UI STATE MACHINE
   ================================================================ */

/**
 * setPhaseUI controls which buttons are enabled/visible.
 *
 * Phases:
 *   idle      → only Start Training
 *   training  → Play Robot, Record
 *   speaking  → all buttons disabled during playback
 *   recording → Stop only
 *   recorded  → Playback, Next (submit)
 *   feedback  → Next (advance to next turn)
 *   loading   → all disabled
 *   done      → Restart
 */
function setPhaseUI(phase) {
  const B = dom;
  const all = [B.btnStart, B.btnPlayRobot, B.btnRecord, B.btnStop, B.btnPlayback, B.btnNext, B.btnRestart];
  all.forEach((b) => { b.disabled = true; b.style.display = ""; });

  B.btnStop.style.display     = "none";
  B.btnPlayback.style.display = "none";
  B.btnNext.style.display     = "none";
  B.btnRestart.style.display  = "none";

  switch (phase) {
    case "idle":
      B.btnStart.disabled     = false;
      break;

    case "training":
      B.btnPlayRobot.disabled = false;
      B.btnRecord.disabled    = false;
      break;

    case "speaking":
      // All disabled — playing audio
      break;

    case "recording":
      B.btnStop.style.display = "";
      B.btnStop.disabled      = false;
      break;

    case "recorded":
      B.btnPlayback.style.display = "";
      B.btnNext.style.display     = "";
      B.btnPlayRobot.disabled     = false;
      B.btnRecord.disabled        = false;
      B.btnPlayback.disabled      = false;
      B.btnNext.disabled          = false;
      break;

    case "feedback":
      B.btnNext.style.display = "";
      B.btnNext.disabled      = false;
      B.btnNext.textContent   = state.phase === "done" ? "完成 ✓" : "下一句 →";
      if (state.phase !== "done") {
        B.btnRecord.disabled    = false;
        B.btnPlayRobot.disabled = false;
      }
      break;

    case "loading":
      // All disabled
      break;

    case "done":
      B.btnRestart.style.display = "";
      B.btnRestart.disabled      = false;
      break;
  }
}

function setAvatarStatus(status) {
  dom.avatarStatus.className = `avatar-status ${status}`;
}

function showBanner(type, text) {
  dom.statusBanner.className = `status-banner ${type}`;
  dom.statusText.textContent = text;
}

/* ================================================================
   SCENE PROGRESS DOTS
   ================================================================ */

function renderSceneDots() {
  dom.sceneDots.innerHTML = "";
  SCENES.forEach((scene, si) => {
    scene.turns.forEach((_, ti) => {
      const dot = document.createElement("div");
      dot.className = "scene-dot";
      dot.title = `${scene.name} 第${ti + 1}轮`;

      if (si < state.sceneIndex || (si === state.sceneIndex && ti < state.turnIndex)) {
        dot.classList.add("done");
      } else if (si === state.sceneIndex && ti === state.turnIndex) {
        dot.classList.add("active");
      }
      dom.sceneDots.appendChild(dot);
    });
  });
}

/* ================================================================
   UTILITIES
   ================================================================ */

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function scoreToLabel(score) {
  if (score >= 80) return "clear";
  if (score >= 50) return "fair";
  return "unclear";
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return iso;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ================================================================
   CANVAS AUDIO VISUALIZER (simple waveform while recording)
   ================================================================ */

let vizRAF = null;
let vizAnalyser = null;
let vizStream = null;

function startVisualizer(stream) {
  const canvas = dom.visualizer;
  if (!canvas) return;
  const ctx2d = canvas.getContext("2d");
  const ctx   = ensureAudioContext();

  vizStream   = stream;
  vizAnalyser = ctx.createAnalyser();
  vizAnalyser.fftSize = 128;

  const src = ctx.createMediaStreamSource(stream);
  src.connect(vizAnalyser);

  const bufLen = vizAnalyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);

  function draw() {
    vizRAF = requestAnimationFrame(draw);
    vizAnalyser.getByteFrequencyData(data);
    const W = canvas.width;
    const H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);
    ctx2d.fillStyle = "#F1F5F9";
    ctx2d.fillRect(0, 0, W, H);

    const barW = (W / bufLen) * 2;
    let x = 0;
    data.forEach((v) => {
      const barH = (v / 255) * H;
      ctx2d.fillStyle = "#2563EB";
      ctx2d.fillRect(x, H - barH, barW - 1, barH);
      x += barW;
    });
  }
  draw();
}

function stopVisualizer() {
  if (vizRAF) { cancelAnimationFrame(vizRAF); vizRAF = null; }
  const canvas = dom.visualizer;
  if (canvas) {
    const ctx2d = canvas.getContext("2d");
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  }
  vizAnalyser = null;
}

/* ================================================================
   EVENT LISTENERS (set up after DOM is ready)
   ================================================================ */

function initEventListeners() {
  dom.btnStart.addEventListener("click", () => {
    startTraining();
    renderSceneDots();
  });

  dom.btnPlayRobot.addEventListener("click", async () => {
    if (!state.currentTurn) return;
    await playRobotVoice(state.currentTurn.robotText);
  });

  dom.btnRecord.addEventListener("click", async () => {
    await handleRecordStart();
  });

  dom.btnStop.addEventListener("click", () => {
    handleRecordStop();
    stopVisualizer();
  });

  dom.btnPlayback.addEventListener("click", handlePlayback);

  dom.btnNext.addEventListener("click", async () => {
    if (state.phase === "feedback") {
      // Advance to the next turn
      hideFeedback();
      await advanceTurn();
    } else {
      // Submit recording
      await handleNext();
    }
  });

  dom.btnRestart.addEventListener("click", () => {
    hideFeedback();
    setPhaseUI("idle");
    showBanner("info", '👋 欢迎开始新的训练！点击"开始训练"。');
    dom.subtitleText.textContent = '点击"开始训练"开始今天的言语康复练习。';
    dom.hintText.textContent     = "";
    dom.sceneDots.innerHTML      = "";
    setAvatarStatus("");
  });

  // ── Auth UI event listeners ──
  dom.btnAuthOpen.addEventListener("click",   () => openAuthModal("login"));
  dom.btnAuthClose.addEventListener("click",  closeAuthModal);
  dom.btnAuthCancel.addEventListener("click", closeAuthModal);
  dom.btnLogout.addEventListener("click",     handleLogout);
  dom.btnSyncNow.addEventListener("click",    syncAllLocalToCloud);

  dom.tabLogin.addEventListener("click",    () => setAuthModalMode("login"));
  dom.tabRegister.addEventListener("click", () => setAuthModalMode("register"));

  dom.btnAuthSubmit.addEventListener("click", () => {
    if (authState.modalMode === "login") {
      handleLogin();
    } else {
      handleRegister();
    }
  });

  // Allow Enter key in password field to submit the form
  dom.authPasswordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") dom.btnAuthSubmit.click();
  });

  // Close modal when clicking the backdrop
  dom.authModal.addEventListener("click", (e) => {
    if (e.target === dom.authModal) closeAuthModal();
  });
}

/* ================================================================
   BOOT
   ================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  setPhaseUI("idle");
  renderDataCenter();
  showBanner("info", '👋 欢迎！点击"开始训练"开始今天的言语康复练习。');
  // Initialize Supabase auth (async — updates UI when session is restored)
  initAuth();
});
