/**
 * settings.js — Settings Tab: Preferences, Account Status
 *
 * Depends on: app.js (window.APP must be defined first)
 * Exposes:    window.SETTINGS
 */

"use strict";

window.SETTINGS = (function () {

  /* ── Defaults ── */

  var DEFAULT_PREFS = {
    fontScale:     1.0,   // 1.0 | 1.1 | 1.2
    highContrast:  false,
    ttsEnabled:    true,  // Web Speech Synthesis on/off
    ttsRate:       1.0,   // 0.9 | 1.0 | 1.1
  };

  /* ── Load / Save ── */

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(APP.LS_PREFS_KEY);
      return raw ? Object.assign({}, DEFAULT_PREFS, JSON.parse(raw)) : Object.assign({}, DEFAULT_PREFS);
    } catch (_) {
      return Object.assign({}, DEFAULT_PREFS);
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(APP.LS_PREFS_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  /* ── Apply preferences to DOM ── */

  function applyPrefs(prefs) {
    // Font scale: multiply root font-size by scale
    document.documentElement.style.setProperty("--font-scale", prefs.fontScale);
    document.documentElement.style.fontSize = (16 * prefs.fontScale) + "px";

    // High contrast
    document.body.classList.toggle("high-contrast", !!prefs.highContrast);
  }

  /* ── Render Settings UI ── */

  function renderUI() {
    var prefs = loadPrefs();

    // Font scale buttons
    var btns = document.querySelectorAll(".font-scale-btn");
    btns.forEach(function (btn) {
      var scale = parseFloat(btn.getAttribute("data-scale"));
      btn.classList.toggle("active", scale === prefs.fontScale);
    });

    // High contrast toggle
    var toggle = document.getElementById("high-contrast-toggle");
    if (toggle) toggle.checked = !!prefs.highContrast;

    // TTS enabled toggle
    var ttsToggle = document.getElementById("tts-enabled-toggle");
    if (ttsToggle) ttsToggle.checked = prefs.ttsEnabled ?? true;

    // TTS rate buttons
    var ttsRateBtns = document.querySelectorAll(".tts-rate-btn");
    ttsRateBtns.forEach(function (btn) {
      var rate = parseFloat(btn.getAttribute("data-rate"));
      btn.classList.toggle("active", rate === (prefs.ttsRate || 1.0));
    });

    // Hide TTS controls if speechSynthesis not supported
    var ttsGroup = document.getElementById("settings-tts-group");
    if (ttsGroup) {
      if (typeof window.TTS !== "undefined" && !TTS.isSupported()) {
        ttsGroup.querySelector(".tts-unsupported-note").style.display = "";
        ttsGroup.querySelector(".tts-controls").style.display = "none";
      }
    }
  }

  function renderAccountStatus() {
    var authState  = APP.authState;
    var statusEl   = document.getElementById("settings-auth-status");
    var emailEl    = document.getElementById("settings-auth-email");
    var syncStatusEl = document.getElementById("settings-sync-status");

    if (!statusEl) return;

    if (authState.user) {
      statusEl.textContent  = "✅ 已登录";
      statusEl.className    = "settings-status-value logged-in";
      if (emailEl) emailEl.textContent = authState.user.email || "";
      if (syncStatusEl) syncStatusEl.textContent = "云端同步已启用";
    } else {
      statusEl.textContent  = "❌ 未登录";
      statusEl.className    = "settings-status-value logged-out";
      if (emailEl) emailEl.textContent = "--";
      if (syncStatusEl) syncStatusEl.textContent = "仅本地存储";
    }
  }

  /* ── Event Listeners ── */

  function initSettingsListeners() {
    // Font scale buttons
    var btns = document.querySelectorAll(".font-scale-btn");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var scale = parseFloat(btn.getAttribute("data-scale"));
        if (!scale) return;
        var prefs = loadPrefs();
        prefs.fontScale = scale;
        savePrefs(prefs);
        applyPrefs(prefs);
        renderUI();
      });
    });

    // High contrast toggle
    var toggle = document.getElementById("high-contrast-toggle");
    if (toggle) {
      toggle.addEventListener("change", function () {
        var prefs = loadPrefs();
        prefs.highContrast = toggle.checked;
        savePrefs(prefs);
        applyPrefs(prefs);
      });
    }

    // TTS enabled toggle
    var ttsToggle = document.getElementById("tts-enabled-toggle");
    if (ttsToggle) {
      ttsToggle.addEventListener("change", function () {
        var prefs = loadPrefs();
        prefs.ttsEnabled = ttsToggle.checked;
        savePrefs(prefs);
      });
    }

    // TTS rate buttons
    var ttsRateBtns = document.querySelectorAll(".tts-rate-btn");
    ttsRateBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var rate = parseFloat(btn.getAttribute("data-rate"));
        if (!rate) return;
        var prefs = loadPrefs();
        prefs.ttsRate = rate;
        savePrefs(prefs);
        renderUI();
      });
    });
  }

  /* ── Init ── */

  function init() {
    var prefs = loadPrefs();
    applyPrefs(prefs);
    renderUI();
    renderAccountStatus();
    initSettingsListeners();
  }

  return {
    init:                init,
    renderAccountStatus: renderAccountStatus,
    loadPrefs:           loadPrefs,
    applyPrefs:          applyPrefs,
  };

})();

document.addEventListener("DOMContentLoaded", function () {
  SETTINGS.init();
});
