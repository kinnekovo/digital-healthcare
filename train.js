/**
 * train.js — Scene Loading, Scene Selection, Training Loop, ASR Recording Flow
 *
 * Implements ASR-only training using Web Speech API (方案1 — Recording Flow).
 * - 开始录音  → recognition.start()  (user gesture required)
 * - 停止录音  → recognition.stop() + show "识别中..." status
 * - On recognition end → display transcript; 确认并评分 always enabled
 * - On error / empty → simple error message + 再试一次 button (no keyword fallback)
 *
 * Depends on: app.js (window.APP must be defined first)
 * Exposes:    window.TRAIN
 */

"use strict";

window.TRAIN = (function () {

  /* ── Scene Data ── */

  var FALLBACK_SCENES = [
    {
      id: "grocery",
      name: "买菜",
      icon: "🛒",
      turns: [
        { robot_text: "您好！今天想去超市买什么菜呀？",      hint: "试着说：白菜、萝卜、土豆……",  keywords: ["菜","买","白菜","萝卜","土豆","苹果","鸡蛋","牛奶"] },
        { robot_text: "好的！那您需要多少斤白菜呢？",         hint: "试着说：一斤、两斤、半斤……",  keywords: ["一","两","半","斤","公斤","克","多少"] },
        { robot_text: "明白了！请问您还需要别的东西吗？",     hint: "试着说：不用了、谢谢、还要……",keywords: ["不用","谢谢","还要","需要","就这些","可以了"] },
      ],
    },
    {
      id: "directions",
      name: "问路",
      icon: "🗺️",
      turns: [
        { robot_text: "请问您想去哪里呀？",                     hint: "试着说：医院、公园、银行……",  keywords: ["医院","公园","银行","邮局","超市","药店","车站","地铁"] },
        { robot_text: "好的，请直走，然后在红绿灯处右转。您听明白了吗？", hint: "试着说：听明白了、知道了……",keywords: ["听","明白","知道","谢谢","好的","清楚","了解"] },
        { robot_text: "很好！那您自己能走过去吗？",             hint: "试着说：能、可以、没问题……",  keywords: ["能","可以","没问题","行","好","我能","我会"] },
      ],
    },
    {
      id: "phone",
      name: "打电话",
      icon: "📞",
      turns: [
        { robot_text: "您好，请问找哪位呀？",               hint: "试着说：找医生、找家人……",     keywords: ["找","医生","护士","家人","儿子","女儿","老伴"] },
        { robot_text: "请问您有什么事情要说吗？",           hint: "试着说：身体不舒服、请来看我……",keywords: ["不舒服","回家","看我","帮忙","肚子","头","疼","难受"] },
        { robot_text: "好的，我已经记下来了。您还有别的要说的吗？", hint: "试着说：没有了、谢谢、再见……",  keywords: ["没有","谢谢","再见","好的","就这些","辛苦了"] },
      ],
    },
  ];

  var LOADED_SCENES = null;

  async function loadScenes() {
    if (LOADED_SCENES) return LOADED_SCENES;
    try {
      var resp = await fetch("scenes.json");
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var json = await resp.json();
      if (json.scenes && json.scenes.length > 0) {
        LOADED_SCENES = json.scenes;
        return LOADED_SCENES;
      }
      throw new Error("Empty scenes array");
    } catch (err) {
      console.warn("[loadScenes] Failed to load scenes.json, using fallback:", err);
      LOADED_SCENES = FALLBACK_SCENES;
      return LOADED_SCENES;
    }
  }

  /* ── Training State ── */

  var state = {
    phase: "idle",       // idle | training | speaking | asr-idle | loading | feedback | done
    scene: null,
    turnIndex: 0,
    currentTurn: null,
    sessionId: null,
    clientSessionId: null,
    sessionTurns: [],
    // ASR fields (per-turn, reset before each turn)
    asrText: "",              // final transcript
    asrSource: "none",        // "speech" | "none"
    asrConfidence: 0.75,
    asrDurationMs: 0,
    asrError: "",             // error code from SpeechRecognition (local only)
  };

  /* ── Constants ── */

  var AMPLITUDE_SMOOTH   = 0.25;
  var DEFAULT_ASR_CONF   = 0.75;
  var DEFAULT_DURATION_MS = 3000;   // fallback duration when no ASR timing available

  /* ── Web Speech API ── */

  var ASR_SUPPORTED = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  var asrRecognition   = null;
  var asrFinalText     = "";
  var asrInterimText   = "";
  var asrBestConf      = 0;
  var asrStartTime     = null;
  var asrHandled       = false;
  var asrUnsupportedBannerShown = false;

  function startWebSpeech() {
    if (!ASR_SUPPORTED) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    asrFinalText   = "";
    asrInterimText = "";
    asrBestConf    = 0;
    asrHandled     = false;
    asrStartTime   = Date.now();

    try {
      asrRecognition = new SR();
      asrRecognition.lang            = "zh-CN";
      asrRecognition.continuous      = false;    // single-utterance per session
      asrRecognition.interimResults  = true;     // live partial transcript
      asrRecognition.maxAlternatives = 1;

      asrRecognition.onresult = function (event) {
        // Accumulate finals; rebuild interim from the changed window only
        asrInterimText = "";
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var res = event.results[i];
          if (res.isFinal) {
            asrFinalText += res[0].transcript;
            var conf = res[0].confidence;
            if (conf && conf > asrBestConf) asrBestConf = conf;
          } else {
            asrInterimText += res[0].transcript;
          }
        }
        updateTranscriptDisplay(asrInterimText, asrFinalText);
      };

      asrRecognition.onerror = function (event) {
        console.warn("[ASR] SpeechRecognition error:", event.error);
        state.asrError = event.error;
        // onend always fires after onerror; let it handle the state transition
      };

      asrRecognition.onend = function () {
        handleASREnd();
      };

      asrRecognition.start();
    } catch (err) {
      console.warn("[ASR] Failed to start SpeechRecognition:", err);
      state.asrError = "failed-to-start";
      handleASREnd();
    }
  }

  function stopWebSpeech() {
    if (asrRecognition) {
      try { asrRecognition.stop(); } catch (_) {}
      // onend will fire and call handleASREnd
    }
  }

  function handleASREnd() {
    if (asrHandled) return;
    asrHandled = true;

    var duration = asrStartTime ? Date.now() - asrStartTime : 0;
    state.asrDurationMs = duration;
    asrStartTime   = null;
    asrRecognition = null;

    // Re-enable start button, disable stop button
    var startBtn = document.getElementById("btn-asr-start");
    var stopBtn  = document.getElementById("btn-asr-stop");
    if (startBtn) startBtn.disabled = false;
    if (stopBtn)  stopBtn.disabled  = true;

    // Always enable confirm so user can proceed even with empty result
    var confirmBtn = document.getElementById("btn-asr-confirm");
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.setAttribute("aria-disabled", "false"); }

    var text = asrFinalText.trim();

    if (text) {
      // Success: we have a final transcript
      state.asrText       = text;
      state.asrSource     = "speech";
      state.asrConfidence = asrBestConf > 0 ? asrBestConf : DEFAULT_ASR_CONF;
      setASRStatus("final");
      hideASRFallback();
    } else {
      // Failure or no speech detected
      state.asrText       = "";
      state.asrSource     = "none";
      state.asrConfidence = DEFAULT_ASR_CONF;
      var errMsg = state.asrError
        ? getASRErrorMsg(state.asrError)
        : "没有识别到内容，请点击【再试一次】重新录音。";
      setASRStatus("error");
      showASRFallback(errMsg);
    }
  }

  function getASRErrorMsg(error) {
    var msgs = {
      "not-allowed":           "⚠️ 麦克风权限被拒绝，请在浏览器设置中允许麦克风后刷新页面。",
      "audio-capture":         "⚠️ 无法访问麦克风，请检查设备连接。",
      "network":               "⚠️ 语音识别服务暂时不可用，请检查网络后重试。",
      "no-speech":             "没有检测到语音，请点击【再试一次】重新录音。",
      "aborted":               "识别被中断，请重试。",
      "language-not-supported":"⚠️ 当前语言不受支持。",
      "failed-to-start":       "⚠️ 语音识别启动失败，请刷新页面后重试。",
    };
    return msgs[error] || ("语音识别出错（" + error + "），请点击【再试一次】重新录音。");
  }

  /* ── ASR Panel ── */

  function showASRPanel() {
    var panel = document.getElementById("asr-panel");
    if (!panel) return;

    // Reset per-turn ASR state
    state.asrText         = "";
    state.asrSource       = "none";
    state.asrError        = "";
    state.asrConfidence   = DEFAULT_ASR_CONF;
    state.asrDurationMs   = 0;
    asrFinalText   = "";
    asrInterimText = "";
    asrHandled     = false;

    updateTranscriptDisplay("", "");

    // Disable confirm until recognition completes
    var confirmBtn = document.getElementById("btn-asr-confirm");
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.setAttribute("aria-disabled", "true"); }

    var startBtn = document.getElementById("btn-asr-start");
    var stopBtn  = document.getElementById("btn-asr-stop");

    if (!ASR_SUPPORTED) {
      if (startBtn) startBtn.disabled = true;
      if (stopBtn)  stopBtn.disabled  = true;
      setASRStatus("error");
      showASRFallback("当前浏览器不支持语音识别（建议使用桌面版 Chrome）。");
      // Still enable confirm so user can proceed (will score with empty text)
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.setAttribute("aria-disabled", "false"); }
      if (!asrUnsupportedBannerShown) {
        APP.showBanner("warning",
          "⚠️ 当前浏览器不支持语音识别（建议使用桌面版 Chrome）。");
        asrUnsupportedBannerShown = true;
      }
    } else {
      if (startBtn) startBtn.disabled = false;
      if (stopBtn)  stopBtn.disabled  = true;
      setASRStatus("idle");
      hideASRFallback();
    }

    panel.style.display = "";
  }

  function hideASRPanel() {
    // Abort any ongoing recognition cleanly
    if (asrRecognition) {
      asrHandled = true; // prevent onend from firing side effects
      try { asrRecognition.abort(); } catch (_) {}
      asrRecognition = null;
    }
    var panel = document.getElementById("asr-panel");
    if (panel) panel.style.display = "none";
  }

  function setASRStatus(status) {
    // status: "idle" | "listening" | "recognizing" | "final" | "error"
    var dot  = document.getElementById("asr-status-dot");
    var text = document.getElementById("asr-status-text");
    if (!dot || !text) return;

    dot.className  = "asr-status-dot "  + status;
    text.className = "asr-status-text " + status;

    var labels = {
      idle:        "等待开始…",
      listening:   "🎙️ 正在录音，请说话…",
      recognizing: "⏳ 识别中…",
      final:       "✅ 识别完成，请确认",
      error:       "识别未成功",
    };
    text.textContent = labels[status] || "";
  }

  function updateTranscriptDisplay(interim, final) {
    var box = document.getElementById("asr-transcript");
    if (!box) return;

    if (!final && !interim) {
      box.innerHTML = '<span class="asr-transcript-placeholder">识别结果将显示在这里…</span>';
      return;
    }

    var html = "";
    if (final)   html += APP.escapeHtml(final);
    if (interim) html += '<span class="asr-transcript-interim"> ' + APP.escapeHtml(interim) + '</span>';
    box.innerHTML = html;
  }

  function updateConfirmBtn() {
    // This is a no-op: confirm button is managed directly in handleASREnd() and showASRPanel().
    // Kept for backward compatibility with any external callers.
  }

  function showASRFallback(msg) {
    var fallback = document.getElementById("asr-fallback");
    var errEl    = document.getElementById("asr-error-msg");
    if (!fallback) return;
    if (errEl) errEl.textContent = msg || "";
    fallback.style.display = "";
  }

  function hideASRFallback() {
    var fallback = document.getElementById("asr-fallback");
    if (fallback) fallback.style.display = "none";
  }

  /* ── Web Audio / Lip-Sync ── */

  var audioCtx    = null;
  var analyser    = null;
  var lipSyncRAF  = null;
  var smoothedAmp = 0;

  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function startLipSync(audioEl) {
    stopLipSync();
    var ctx = ensureAudioContext();
    try {
      var source = ctx.createMediaElementSource(audioEl);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      var bufLen  = analyser.frequencyBinCount;
      var dataArr = new Uint8Array(bufLen);

      function tick() {
        if (!analyser) return;
        analyser.getByteTimeDomainData(dataArr);
        var sumSq = 0;
        for (var i = 0; i < bufLen; i++) {
          var norm = (dataArr[i] - 128) / 128;
          sumSq += norm * norm;
        }
        var rms = Math.sqrt(sumSq / bufLen);
        smoothedAmp = AMPLITUDE_SMOOTH * rms + (1 - AMPLITUDE_SMOOTH) * smoothedAmp;
        setMouthOpen(Math.min(smoothedAmp / 0.3, 1));
        lipSyncRAF = requestAnimationFrame(tick);
      }
      lipSyncRAF = requestAnimationFrame(tick);
    } catch (_) {
      // ignore — mouth stays closed
    }
  }

  function stopLipSync() {
    if (lipSyncRAF) { cancelAnimationFrame(lipSyncRAF); lipSyncRAF = null; }
    analyser    = null;
    smoothedAmp = 0;
    setMouthOpen(0);
  }

  var _mouthEl = null;
  function getMouthEl() {
    if (_mouthEl) return _mouthEl;
    _mouthEl = document.getElementById("mouth-open");
    if (_mouthEl) return _mouthEl;
    var obj = document.getElementById("avatar-object");
    if (obj && obj.contentDocument) {
      _mouthEl = obj.contentDocument.getElementById("mouth-open");
    }
    return _mouthEl;
  }

  function setMouthOpen(ratio) {
    var el = getMouthEl();
    if (!el) return;
    el.setAttribute("ry", Math.round(ratio * 14 * 10) / 10);
  }

  /* ── Mock API ── */

  async function MOCK_SCORE(asrText, confidence, keywords, durationMs) {
    await APP.sleep(400);
    var safeText = typeof asrText === "string" ? asrText : "";
    var asrLower = safeText.toLowerCase();
    var hits = keywords.filter(function (k) { return asrLower.includes(k); }).length;
    var hit  = keywords.length > 0 ? hits / keywords.length : 0.5;
    var chars = safeText.length || 1;
    var secs  = (durationMs || DEFAULT_DURATION_MS) / 1000;
    var cps   = chars / secs;
    var pace  = (cps >= 0.5 && cps <= 4) ? 1.0 : (cps >= 0.3 ? 0.6 : 0.3);
    var rawScore = 100 * (0.5 * confidence + 0.4 * hit + 0.1 * pace);
    // Non-cryptographic jitter for demo variability — intentionally uses Math.random()
    var jitter   = (Math.random() - 0.5) * 10; // ±5 points of demo noise
    var score    = Math.round(Math.max(0, Math.min(100, rawScore + jitter)));
    var label, feedback, tip;
    if (score >= 80) {
      label = "clear";   feedback = "👏 非常清晰！说得很好！";          tip = "继续保持，您进步很快！";
    } else if (score >= 50) {
      label = "fair";    feedback = "👍 还不错，部分词语可以更清楚。";   tip = "试着放慢语速，每个字说清楚一点。";
    } else {
      label = "unclear"; feedback = "💪 没关系，我们再练习一次！";       tip = "深呼吸，慢慢说，每个字都很重要。";
    }
    return { score: score, label: label, feedback: feedback, tip: tip };
  }

  async function MOCK_TTS(_text) {
    return { audio_url: APP.SAMPLE_AUDIO };
  }

  /* ── Audio Playback with Lip-Sync ── */

  function playAudioWithLipSync(url) {
    return new Promise(function (resolve) {
      var audio = new Audio(url);
      audio.crossOrigin = "anonymous";
      audio.addEventListener("play", function () {
        try { ensureAudioContext(); startLipSync(audio); } catch (_) {}
      }, { once: true });
      audio.addEventListener("ended", function () { stopLipSync(); resolve(); });
      audio.addEventListener("error", function () {
        stopLipSync();
        APP.showBanner("warning", "⚠️ 示例音频加载失败。");
        resolve();
      });
      audio.play().catch(function () { stopLipSync(); resolve(); });
    });
  }

  async function playRobotVoice(text) {
    setAvatarStatus("speaking");
    try {
      var result = await MOCK_TTS(text);
      await playAudioWithLipSync(result.audio_url);
    } finally {
      setAvatarStatus("ready");
    }
  }

  /* ── Scene Selection ── */

  async function renderSceneSelect() {
    var scenes = await loadScenes();
    var grid   = document.getElementById("scene-select-grid");
    if (!grid) return;
    grid.innerHTML = "";
    scenes.forEach(function (scene) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "scene-card";
      card.setAttribute("aria-label", scene.name + "场景");
      card.innerHTML =
        '<span class="scene-card-icon">' + scene.icon + '</span>' +
        '<span class="scene-card-name">'  + APP.escapeHtml(scene.name)   + '</span>' +
        '<span class="scene-card-turns">' + scene.turns.length + ' 轮对话</span>';
      card.addEventListener("click", function () { beginTraining(scene); });
      grid.appendChild(card);
    });
  }

  /* ── Training Flow ── */

  async function beginTraining(scene) {
    state.phase            = "training";
    state.scene            = scene;
    state.turnIndex        = 0;
    state.sessionTurns     = [];
    state.sessionId        = "session_" + Date.now();
    state.clientSessionId  = APP.generateUUID();
    // Reset ASR state
    state.asrText          = "";
    state.asrSource        = "none";
    state.asrConfidence    = DEFAULT_ASR_CONF;
    state.asrDurationMs    = 0;
    state.asrError         = "";

    var selectDiv  = document.getElementById("scene-select");
    var trainingUI = document.getElementById("training-ui");
    if (selectDiv)  selectDiv.style.display  = "none";
    if (trainingUI) trainingUI.style.display = "";

    renderTurnDots();
    hideFeedback();
    await advanceTurn();
  }

  async function advanceTurn() {
    var scene = state.scene;
    var turn  = scene.turns[state.turnIndex];
    state.currentTurn = turn;

    hideASRPanel();
    hideFeedback();

    var subtitleEl = document.getElementById("subtitle-text");
    var hintEl     = document.getElementById("hint-text");
    if (subtitleEl) subtitleEl.textContent = turn.robot_text;
    if (hintEl)     hintEl.textContent     = turn.hint || "";

    APP.showBanner("info",
      "📖 场景：" + scene.icon + " " + scene.name +
      "  |  第 " + (state.turnIndex + 1) + " / " + scene.turns.length + " 轮");

    state.phase = "speaking";
    setPhaseUI("speaking");

    await playRobotVoice(turn.robot_text);

    // After robot finishes speaking, show the ASR panel
    state.phase = "asr-idle";
    setPhaseUI("asr-idle");
    showASRPanel();
    APP.showBanner("info", "🎙️ 请点击【开始录音】后说出您的回答。");
  }

  async function doScoring() {
    hideASRPanel();
    APP.showBanner("info", "⏳ 正在评分…");
    state.phase = "loading";
    setPhaseUI("loading");

    var turn       = state.currentTurn;
    var keywords   = turn.keywords || turn.expectedKeywords || [];
    var confidence = state.asrSource === "speech" ? state.asrConfidence : DEFAULT_ASR_CONF;

    var scoreResult = await MOCK_SCORE(
      state.asrText,
      confidence,
      keywords,
      state.asrDurationMs || DEFAULT_DURATION_MS
    );

    var turnRecord = {
      scene_id:    state.scene.id,
      scene_name:  state.scene.name,
      turn_index:  state.turnIndex,
      robot_text:  turn.robot_text,
      asr_text:    state.asrText,
      asr_source:  state.asrSource,
      confidence:  confidence,
      score:       scoreResult.score,
      label:       scoreResult.label,
      duration_ms: state.asrDurationMs,
      timestamp:   new Date().toISOString(),
    };
    if (state.asrError) turnRecord.asr_error = state.asrError;
    state.sessionTurns.push(turnRecord);

    showFeedback(scoreResult.score, scoreResult.label, scoreResult.feedback, scoreResult.tip);
    state.phase = "feedback";

    var isLastTurn = state.turnIndex >= state.scene.turns.length - 1;

    if (isLastTurn) {
      state.phase = "done";
      var savedSession = await saveSession();
      setPhaseUI("done");
      APP.showBanner("success", "🎉 训练完成！正在保存数据…");
      renderTurnDots();

      APP.syncSessionToCloud(savedSession).catch(function () {
        APP.showBanner("warning", "⚠️ 数据已保存到本地，但云端同步失败，可稍后点击立即同步重试。");
      });

      setTimeout(function () {
        APP.pendingHighlightId = savedSession.client_session_id;
        APP.navigateTo("data");
      }, 1200);

    } else {
      state.turnIndex++;
      renderTurnDots();
      setPhaseUI("feedback");
    }
  }

  async function saveSession() {
    var turns    = state.sessionTurns;
    var avgScore = turns.length > 0
      ? Math.round(turns.reduce(function (s, t) { return s + t.score; }, 0) / turns.length)
      : 0;

    var session = {
      session_id:        state.sessionId,
      client_session_id: state.clientSessionId,
      timestamp:         new Date().toISOString(),
      scene_id:          state.scene.id,
      scene_name:        state.scene.name,
      scene_names:       state.scene.name,
      turn_count:        turns.length,
      avg_score:         avgScore,
      avg_label:         APP.scoreToLabel(avgScore),
      turns:             turns,
    };

    var existing = APP.loadSessions();
    existing.unshift(session);
    APP.saveSessions(existing.slice(0, 50));
    return session;
  }

  /* ── Feedback Panel ── */

  function showFeedback(score, label, feedback, tip) {
    var panel   = document.getElementById("feedback-panel");
    var circle  = document.getElementById("score-circle");
    var numEl   = document.getElementById("score-num");
    var labelEl = document.getElementById("score-label");
    var feedEl  = document.getElementById("feedback-text");
    var tipEl   = document.getElementById("feedback-tip");
    if (panel)   panel.classList.add("visible");
    if (circle)  circle.className = "score-circle " + label;
    if (numEl)   numEl.textContent   = score;
    if (labelEl) labelEl.textContent = label === "clear" ? "清晰" : label === "fair" ? "一般" : "需改进";
    if (feedEl)  feedEl.textContent  = feedback;
    if (tipEl)   tipEl.textContent   = tip;
  }

  function hideFeedback() {
    var panel = document.getElementById("feedback-panel");
    if (panel) panel.classList.remove("visible");
  }

  /* ── Turn Progress Dots ── */

  function renderTurnDots() {
    var container = document.getElementById("scene-dots");
    if (!container || !state.scene) return;
    container.innerHTML = "";
    state.scene.turns.forEach(function (_, ti) {
      var dot = document.createElement("div");
      dot.className = "scene-dot";
      dot.title = state.scene.name + " 第" + (ti + 1) + "轮";
      if (ti < state.turnIndex)        dot.classList.add("done");
      else if (ti === state.turnIndex) dot.classList.add("active");
      container.appendChild(dot);
    });
  }

  /* ── Avatar Status ── */

  function setAvatarStatus(status) {
    var el = document.getElementById("avatar-status");
    if (el) el.className = "avatar-status " + status;
  }

  /* ── Phase UI State Machine ── */

  function setPhaseUI(phase) {
    var controlled = ["btn-play-robot", "btn-next", "btn-restart"];
    controlled.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.disabled = true; el.style.display = "none"; }
    });

    function show(id, enabled) {
      var el = document.getElementById(id);
      if (el) { el.style.display = ""; if (enabled) el.disabled = false; }
    }

    switch (phase) {
      case "idle":
        break;
      case "speaking":
        show("btn-play-robot", false); // visible but disabled while robot speaks
        break;
      case "asr-idle":
        show("btn-play-robot", true);
        break;
      case "loading":
        break;
      case "feedback":
        show("btn-play-robot", true);
        show("btn-next", true);
        var btnNext = document.getElementById("btn-next");
        if (btnNext) btnNext.textContent = "下一句 →";
        break;
      case "done":
        show("btn-restart", true);
        break;
    }
  }

  /* ── Reset to Scene Selection ── */

  function resetToSelection() {
    hideASRPanel();
    hideFeedback();
    state.phase = "idle";
    var selectDiv  = document.getElementById("scene-select");
    var trainingUI = document.getElementById("training-ui");
    if (selectDiv)  selectDiv.style.display  = "";
    if (trainingUI) trainingUI.style.display = "none";
    var dotsEl = document.getElementById("scene-dots");
    if (dotsEl) dotsEl.innerHTML = "";
    var subtitleEl = document.getElementById("subtitle-text");
    if (subtitleEl) subtitleEl.textContent = "请选择一个训练场景开始练习。";
    var hintEl = document.getElementById("hint-text");
    if (hintEl) hintEl.textContent = "";
    setAvatarStatus("");
    APP.showBanner("info", "👋 请选择一个场景开始今天的言语康复练习。");
  }

  /* ── Event Listeners ── */

  function initTrainListeners() {
    function on(id, evt, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    }

    // Replay robot prompt at any time during a turn
    on("btn-play-robot", "click", async function () {
      if (!state.currentTurn) return;
      await playRobotVoice(state.currentTurn.robot_text);
    });

    // Advance to next turn (shown during feedback phase)
    on("btn-next", "click", async function () {
      hideFeedback();
      await advanceTurn();
    });

    // Start recording + ASR — MUST be a direct user gesture for Chrome microphone permission
    on("btn-asr-start", "click", function () {
      if (!ASR_SUPPORTED) return;
      // Reset per-recognition state
      state.asrError = "";
      asrFinalText   = "";
      asrInterimText = "";
      asrHandled     = false;

      hideASRFallback();
      updateTranscriptDisplay("", "");
      setASRStatus("listening");

      var startBtn = document.getElementById("btn-asr-start");
      var stopBtn  = document.getElementById("btn-asr-stop");
      var confirmBtn = document.getElementById("btn-asr-confirm");
      if (startBtn)   startBtn.disabled   = true;
      if (stopBtn)    stopBtn.disabled    = false;
      if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.setAttribute("aria-disabled", "true"); }

      startWebSpeech();
    });

    // Stop recording — show "识别中..." and wait for recognition result
    on("btn-asr-stop", "click", function () {
      var startBtn = document.getElementById("btn-asr-start");
      var stopBtn  = document.getElementById("btn-asr-stop");
      if (startBtn) startBtn.disabled = true;
      if (stopBtn)  stopBtn.disabled  = true;
      setASRStatus("recognizing");
      stopWebSpeech();
      // onend fires asynchronously; handleASREnd() handles result
    });

    // Confirm transcript and proceed to scoring
    on("btn-asr-confirm", "click", async function () {
      await doScoring();
    });

    // Retry: reset panel to idle (re-enable 开始录音)
    on("btn-asr-retry", "click", function () {
      state.asrError  = "";
      state.asrText   = "";
      state.asrSource = "none";
      asrFinalText    = "";
      asrInterimText  = "";
      asrHandled      = false;

      hideASRFallback();
      updateTranscriptDisplay("", "");
      setASRStatus("idle");

      var startBtn   = document.getElementById("btn-asr-start");
      var stopBtn    = document.getElementById("btn-asr-stop");
      var confirmBtn = document.getElementById("btn-asr-confirm");
      if (startBtn)   startBtn.disabled   = !ASR_SUPPORTED;
      if (stopBtn)    stopBtn.disabled    = true;
      if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.setAttribute("aria-disabled", "true"); }
    });

    // Return to scene selection
    on("btn-restart", "click", function () {
      resetToSelection();
    });
  }

  /* ── Public API ── */

  return {
    init: async function () {
      await renderSceneSelect();
      initTrainListeners();
      resetToSelection();
    },
  };

})();

/* ── Boot train module when DOM is ready ── */
document.addEventListener("DOMContentLoaded", function () {
  TRAIN.init();
});
