/**
 * train.js — Scene Loading, Scene Selection, Training Loop, Recording, Lip-Sync
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
    phase: "idle",       // idle | selecting | training | speaking | recording | asr-review | feedback | done
    scene: null,         // selected scene object
    turnIndex: 0,
    currentTurn: null,
    sessionId: null,
    clientSessionId: null,
    sessionTurns: [],
    recordingBlob: null,
    recordingUrl: null,
    recordingDurationMs: 0,
    recordingStartTime: null,
    asrText: "",         // confirmed text from ASR panel (empty = use mock)
    asrSource: "mock",   // "web_speech" | "manual" | "fallback" | "mock"
    asrConfidence: 0.75, // confidence from Web Speech API (when available)
  };

  /* ── Constants ── */

  var MAX_RECORD_MS      = 10000;
  var AMPLITUDE_SMOOTH   = 0.25;
  var DEFAULT_ASR_CONF   = 0.75;  // confidence used when ASR API reports no confidence value

  /* ── Web Speech API (ASR) ── */

  var ASR_SUPPORTED = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  var asrRecognition = null;    // active SpeechRecognition instance
  var asrAccumText   = "";      // accumulated final transcript
  var asrBestConf    = 0;       // highest confidence value received in the current session

  function startWebSpeech() {
    if (!ASR_SUPPORTED) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    asrAccumText = "";
    asrBestConf  = 0;
    try {
      asrRecognition = new SR();
      asrRecognition.lang = "zh-CN";
      asrRecognition.continuous = true;
      asrRecognition.interimResults = true;
      asrRecognition.maxAlternatives = 1;

      asrRecognition.onresult = function (event) {
        var finalText   = "";
        var interimText = "";
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var res = event.results[i];
          if (res.isFinal) {
            finalText += res[0].transcript;
            var conf = res[0].confidence;
            if (conf && conf > asrBestConf) asrBestConf = conf;
          } else {
            interimText += res[0].transcript;
          }
        }
        if (finalText) asrAccumText += finalText;
        // Live-update the textarea if the ASR panel is already visible
        var textarea = document.getElementById("asr-textarea");
        var panel    = document.getElementById("asr-panel");
        if (textarea && panel && panel.style.display !== "none") {
          textarea.value = asrAccumText + interimText;
        }
      };

      asrRecognition.onerror = function (event) {
        console.warn("[ASR] SpeechRecognition error:", event.error);
      };

      asrRecognition.start();
    } catch (err) {
      console.warn("[ASR] Failed to start SpeechRecognition:", err);
      asrRecognition = null;
    }
  }

  function stopWebSpeech() {
    if (asrRecognition) {
      try { asrRecognition.stop(); } catch (_) {}
      asrRecognition = null;
    }
  }

  /* ── ASR Panel ── */

  function showASRPanel() {
    var panel    = document.getElementById("asr-panel");
    var textarea = document.getElementById("asr-textarea");
    var badge    = document.getElementById("asr-status-badge");
    if (!panel || !textarea) return;

    var text   = asrAccumText.trim();
    var source, badgeText, badgeClass;

    if (!ASR_SUPPORTED) {
      source     = "fallback";
      badgeText  = "⚠️ 浏览器不支持语音识别，请手动输入";
      badgeClass = "fallback";
    } else if (text) {
      source     = "web_speech";
      badgeText  = "✅ 语音识别成功（Chrome · 普通话）";
      badgeClass = "web-speech";
    } else {
      source     = "manual";
      badgeText  = "💡 未识别到内容，请手动输入或选择关键词";
      badgeClass = "empty";
    }

    textarea.value   = text;
    state.asrSource  = source;
    state.asrText    = text;
    // Use DEFAULT_ASR_CONF as fallback if no confidence was received from the API
    state.asrConfidence = asrBestConf > 0 ? asrBestConf : DEFAULT_ASR_CONF;

    if (badge) {
      badge.textContent = badgeText;
      badge.className   = "asr-status-badge " + badgeClass;
    }

    // Listen for manual edits to update source label
    textarea.oninput = function () {
      state.asrText   = textarea.value;
      state.asrSource = "manual";
      if (badge) {
        badge.textContent = "✏️ 已手动编辑";
        badge.className   = "asr-status-badge manual";
      }
    };

    // Render keyword quick-pick buttons
    var keywords = (state.currentTurn && state.currentTurn.keywords) ? state.currentTurn.keywords : [];
    renderKeywordButtons(keywords, textarea, badge);

    panel.style.display = "";
    textarea.focus();
  }

  function renderKeywordButtons(keywords, textarea, badge) {
    var container = document.getElementById("asr-keywords");
    if (!container) return;
    container.innerHTML = "";
    if (!keywords || keywords.length === 0) return;

    var labelEl = document.createElement("span");
    labelEl.className   = "asr-keywords-label";
    labelEl.textContent = "快速添加关键词：";
    container.appendChild(labelEl);

    keywords.forEach(function (kw) {
      var btn = document.createElement("button");
      btn.type      = "button";
      btn.className = "asr-keyword-btn";
      btn.textContent = kw;
      btn.addEventListener("click", function () {
        if (!textarea) return;
        var current = textarea.value;
        textarea.value = current ? current + " " + kw : kw;
        state.asrText   = textarea.value;
        state.asrSource = "manual";
        if (badge) {
          badge.textContent = "✏️ 已手动编辑";
          badge.className   = "asr-status-badge manual";
        }
        textarea.focus();
      });
      container.appendChild(btn);
    });
  }

  function hideASRPanel() {
    var panel = document.getElementById("asr-panel");
    if (panel) panel.style.display = "none";
    // Clear textarea listener to avoid stale closures
    var textarea = document.getElementById("asr-textarea");
    if (textarea) textarea.oninput = null;
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

      var bufLen   = analyser.frequencyBinCount;
      var dataArr  = new Uint8Array(bufLen);

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

  /* ── Canvas Waveform Visualizer ── */

  var vizRAF      = null;
  var vizAnalyser = null;

  function startVisualizer(stream) {
    var canvas = document.getElementById("visualizer");
    if (!canvas) return;
    var ctx2d = canvas.getContext("2d");
    var ctx   = ensureAudioContext();
    vizAnalyser = ctx.createAnalyser();
    vizAnalyser.fftSize = 128;
    var src = ctx.createMediaStreamSource(stream);
    src.connect(vizAnalyser);
    var bufLen = vizAnalyser.frequencyBinCount;
    var data   = new Uint8Array(bufLen);

    function draw() {
      vizRAF = requestAnimationFrame(draw);
      vizAnalyser.getByteFrequencyData(data);
      var W = canvas.width, H = canvas.height;
      ctx2d.clearRect(0, 0, W, H);
      ctx2d.fillStyle = "#F1F5F9";
      ctx2d.fillRect(0, 0, W, H);
      var barW = (W / bufLen) * 2;
      var x = 0;
      data.forEach(function (v) {
        var barH = (v / 255) * H;
        ctx2d.fillStyle = "#2563EB";
        ctx2d.fillRect(x, H - barH, barW - 1, barH);
        x += barW;
      });
    }
    draw();
  }

  function stopVisualizer() {
    if (vizRAF) { cancelAnimationFrame(vizRAF); vizRAF = null; }
    var canvas = document.getElementById("visualizer");
    if (canvas) {
      var ctx2d = canvas.getContext("2d");
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
    vizAnalyser = null;
  }

  /* ── Media Recorder ── */

  var mediaRecorder  = null;
  var recordChunks   = [];
  var recTimerInterval = null;

  function getSupportedMimeType() {
    var types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
    return types.find(function (t) {
      return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t);
    }) || "";
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      APP.showBanner("danger", "⚠️ 您的浏览器不支持录音功能，请使用 Chrome 或 Safari。");
      return false;
    }
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      var msg = err.name === "NotAllowedError"
        ? "麦克风权限被拒绝，请在浏览器设置中允许麦克风权限后刷新页面。"
        : "无法访问麦克风，请检查设备连接和浏览器权限后重试。";
      APP.showBanner("danger", "⚠️ " + msg);
      return false;
    }

    startVisualizer(stream);
    startWebSpeech();   // Start ASR alongside MediaRecorder

    recordChunks = [];
    var mimeType = getSupportedMimeType();
    var options  = mimeType ? { mimeType: mimeType } : {};
    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = function (e) {
      if (e.data.size > 0) recordChunks.push(e.data);
    };
    mediaRecorder.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      finalizeRecording();
    };
    mediaRecorder.start(100);

    state.recordingStartTime = Date.now();
    updateRecTimer();
    recTimerInterval = setInterval(updateRecTimer, 500);

    setTimeout(function () {
      if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
    }, MAX_RECORD_MS);

    return true;
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
    clearInterval(recTimerInterval);
    stopWebSpeech();   // Stop ASR alongside MediaRecorder
  }

  function finalizeRecording() {
    var mimeType = getSupportedMimeType() || "audio/webm";
    state.recordingBlob        = new Blob(recordChunks, { type: mimeType });
    state.recordingDurationMs  = Date.now() - state.recordingStartTime;
    state.recordingUrl         = URL.createObjectURL(state.recordingBlob);
    state.recordingStartTime   = null;
    // Reset ASR state before showing panel
    state.asrText       = "";
    state.asrSource     = "mock";
    state.asrConfidence = asrBestConf;
    setPhaseUI("asr-review");
    showASRPanel();
    APP.showBanner("info", "✅ 录音完成，请确认识别结果后提交。");
  }

  function updateRecTimer() {
    var el = document.getElementById("rec-timer");
    if (!el || !state.recordingStartTime) return;
    var elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
    el.textContent = elapsed + "s / " + (MAX_RECORD_MS / 1000) + "s";
  }

  /* ── Mock API ── */

  async function MOCK_ASR(audioBlob, keywords) {
    await APP.sleep(800);
    var keyword = keywords[Math.floor(Math.random() * keywords.length)];
    var confidence = 0.5 + Math.random() * 0.5;
    return { text: keyword, confidence: confidence };
  }

  async function MOCK_SCORE(asrText, confidence, keywords, durationMs) {
    await APP.sleep(400);
    var safeText = typeof asrText === "string" ? asrText : "";
    var asrLower = safeText.toLowerCase();
    var hits = keywords.filter(function (k) { return asrLower.includes(k); }).length;
    var hit  = keywords.length > 0 ? hits / keywords.length : 0.5;
    var chars = safeText.length || 1;
    var secs  = durationMs / 1000;
    var cps   = chars / secs;
    var pace  = (cps >= 0.5 && cps <= 4) ? 1.0 : (cps >= 0.3 ? 0.6 : 0.3);
    var rawScore = 100 * (0.5 * confidence + 0.4 * hit + 0.1 * pace);
    var jitter   = (Math.random() - 0.5) * 10;
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

  /* ── Audio playback with lip-sync ── */

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
    state.phase = "speaking";
    setPhaseUI("speaking");
    setAvatarStatus("speaking");
    var result = await MOCK_TTS(text);
    await playAudioWithLipSync(result.audio_url);
    state.phase = "training";
    setPhaseUI("training");
    setAvatarStatus("ready");
  }

  /* ── Scene Selection ── */

  async function renderSceneSelect() {
    var scenes  = await loadScenes();
    var grid    = document.getElementById("scene-select-grid");
    if (!grid) return;
    grid.innerHTML = "";
    scenes.forEach(function (scene) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "scene-card";
      card.setAttribute("aria-label", scene.name + "场景");
      card.innerHTML =
        '<span class="scene-card-icon">' + scene.icon + '</span>' +
        '<span class="scene-card-name">' + APP.escapeHtml(scene.name) + '</span>' +
        '<span class="scene-card-turns">' + scene.turns.length + ' 轮对话</span>';
      card.addEventListener("click", function () { beginTraining(scene); });
      grid.appendChild(card);
    });
  }

  /* ── Training Flow ── */

  async function beginTraining(scene) {
    state.phase       = "training";
    state.scene       = scene;
    state.turnIndex   = 0;
    state.sessionTurns  = [];
    state.sessionId     = "session_" + Date.now();
    state.clientSessionId = APP.generateUUID();
    state.recordingBlob = null;
    state.recordingUrl  = null;

    // Switch from scene-select to training UI
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
    var subtitleEl = document.getElementById("subtitle-text");
    var hintEl     = document.getElementById("hint-text");
    if (subtitleEl) subtitleEl.textContent = turn.robot_text;
    if (hintEl)     hintEl.textContent     = turn.hint || "";

    hideFeedback();
    APP.showBanner("info",
      "📖 场景：" + scene.icon + " " + scene.name +
      "  |  第 " + (state.turnIndex + 1) + " / " + scene.turns.length + " 轮");
    setPhaseUI("training");
    await playRobotVoice(turn.robot_text);
  }

  async function handleNext() {
    if (!state.recordingBlob || !state.recordingUrl) {
      APP.showBanner("warning", "⚠️ 请先录音再继续。");
      return;
    }

    hideASRPanel();
    APP.showBanner("info", "⏳ 正在分析您的语音…");
    setPhaseUI("loading");

    var turn     = state.currentTurn;
    var keywords = turn.keywords || turn.expectedKeywords || [];

    // Use confirmed ASR text when available; fall back to mock
    var asrResult;
    if (state.asrText !== "" && state.asrSource !== "mock") {
      asrResult = {
        text:       state.asrText,
        confidence: (state.asrSource === "web_speech") ? state.asrConfidence : DEFAULT_ASR_CONF,
      };
    } else {
      asrResult = await MOCK_ASR(state.recordingBlob, keywords);
    }

    var scoreResult = await MOCK_SCORE(
      asrResult.text, asrResult.confidence, keywords, state.recordingDurationMs
    );

    var turnRecord = {
      scene_id:     state.scene.id,
      scene_name:   state.scene.name,
      turn_index:   state.turnIndex,
      robot_text:   turn.robot_text,
      asr_text:     asrResult.text,
      asr_source:   state.asrSource,
      confidence:   asrResult.confidence,
      score:        scoreResult.score,
      label:        scoreResult.label,
      duration_ms:  state.recordingDurationMs,
      timestamp:    new Date().toISOString(),
    };
    state.sessionTurns.push(turnRecord);

    showFeedback(scoreResult.score, scoreResult.label, scoreResult.feedback, scoreResult.tip);
    state.phase = "feedback";
    setPhaseUI("feedback");

    var isLastTurn = state.turnIndex >= state.scene.turns.length - 1;

    if (isLastTurn) {
      state.phase = "done";
      var savedSession = await saveSession();
      setPhaseUI("done");
      APP.showBanner("success", "🎉 训练完成！正在保存数据…");
      renderTurnDots();

      // Async cloud sync
      APP.syncSessionToCloud(savedSession).catch(function () {
        APP.showBanner("warning", "⚠️ 数据已保存到本地，但云端同步失败，可稍后点击立即同步重试。");
      });

      // Navigate to Data Center after a brief delay, highlight new session
      setTimeout(function () {
        APP.pendingHighlightId = savedSession.client_session_id;
        APP.navigateTo("data");
      }, 1200);

    } else {
      state.turnIndex++;
      renderTurnDots();
      setPhaseUI("feedback");
    }

    state.recordingBlob = null;
    state.recordingUrl  = null;
    state.asrText       = "";
    state.asrSource     = "mock";
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
    var panel    = document.getElementById("feedback-panel");
    var circle   = document.getElementById("score-circle");
    var numEl    = document.getElementById("score-num");
    var labelEl  = document.getElementById("score-label");
    var feedEl   = document.getElementById("feedback-text");
    var tipEl    = document.getElementById("feedback-tip");
    if (panel)   panel.classList.add("visible");
    if (circle)  circle.className = "score-circle " + label;
    if (numEl)   numEl.textContent  = score;
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
    var ids = ["btn-start-placeholder", "btn-play-robot", "btn-record", "btn-stop", "btn-playback", "btn-next", "btn-restart"];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.disabled = true; el.style.display = ""; }
    });

    function hide(id) { var el = document.getElementById(id); if (el) el.style.display = "none"; }
    function show(id, enabled) { var el = document.getElementById(id); if (el) { el.style.display = ""; if (enabled) el.disabled = false; } }
    function enable(id) { var el = document.getElementById(id); if (el) el.disabled = false; }

    hide("btn-start-placeholder");
    hide("btn-stop");
    hide("btn-playback");
    hide("btn-next");
    hide("btn-restart");

    switch (phase) {
      case "idle":
        show("btn-start-placeholder", true);
        break;
      case "training":
        enable("btn-play-robot");
        enable("btn-record");
        break;
      case "speaking":
        break;
      case "recording":
        show("btn-stop", true);
        break;
      case "asr-review":
        show("btn-playback", true);
        enable("btn-play-robot");
        enable("btn-record");
        break;
      case "recorded":
        show("btn-playback", true);
        show("btn-next", true);
        enable("btn-play-robot");
        enable("btn-record");
        break;
      case "feedback":
        show("btn-next", true);
        var btnNext = document.getElementById("btn-next");
        if (btnNext) btnNext.textContent = state.phase === "done" ? "完成 ✓" : "下一句 →";
        if (state.phase !== "done") {
          enable("btn-record");
          enable("btn-play-robot");
        }
        break;
      case "loading":
        break;
      case "done":
        show("btn-restart", true);
        break;
    }

    var recInd = document.getElementById("rec-indicator");
    if (recInd) {
      recInd.classList.toggle("active", phase === "recording");
    }
  }

  /* ── Reset to Scene Selection ── */

  function resetToSelection() {
    hideFeedback();
    hideASRPanel();
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

    on("btn-play-robot", "click", async function () {
      if (!state.currentTurn) return;
      await playRobotVoice(state.currentTurn.robot_text);
    });

    on("btn-record", "click", async function () {
      state.recordingBlob = null;
      state.recordingUrl  = null;
      hideASRPanel();
      var ok = await startRecording();
      if (!ok) return;
      state.phase = "recording";
      setPhaseUI("recording");
      setAvatarStatus("listening");
      APP.showBanner("danger", "🎙️ 正在录音…");
    });

    on("btn-stop", "click", function () {
      stopRecording();
      stopVisualizer();
      setAvatarStatus("ready");
    });

    on("btn-playback", "click", function () {
      if (!state.recordingUrl) return;
      var audio = new Audio(state.recordingUrl);
      audio.play().catch(function () { APP.showBanner("warning", "⚠️ 无法播放录音。"); });
    });

    on("btn-next", "click", async function () {
      if (state.phase === "feedback") {
        hideFeedback();
        state.recordingBlob = null;
        state.recordingUrl  = null;
        await advanceTurn();
      } else {
        await handleNext();
      }
    });

    on("btn-asr-confirm", "click", async function () {
      // Read the current text from the textarea before submitting
      var textarea = document.getElementById("asr-textarea");
      if (textarea) {
        state.asrText = textarea.value.trim();
      }
      await handleNext();
    });

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
