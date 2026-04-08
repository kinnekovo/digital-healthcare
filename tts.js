/**
 * tts.js — Text-to-Speech helper using Web Speech Synthesis API
 *
 * Provides zero-cost TTS for robot prompts in the Train tab.
 * Language: zh-CN. Settings (ttsEnabled, ttsRate) stored in rehab_prefs_v1.
 *
 * Depends on: app.js (APP.LS_PREFS_KEY)
 * Exposes:    window.TTS
 */

"use strict";

window.TTS = (function () {

  var TTS_SUPPORTED = typeof window.speechSynthesis !== "undefined";

  /* ── Read TTS prefs from localStorage ── */

  function loadTTSPrefs() {
    try {
      var raw = localStorage.getItem(
        (window.APP && APP.LS_PREFS_KEY) ? APP.LS_PREFS_KEY : "rehab_prefs_v1"
      );
      var prefs = raw ? JSON.parse(raw) : {};
      return {
        ttsEnabled: prefs.ttsEnabled ?? true, // default true
        ttsRate:    typeof prefs.ttsRate === "number" ? prefs.ttsRate : 1.0,
      };
    } catch (_) {
      return { ttsEnabled: true, ttsRate: 1.0 };
    }
  }

  /* ── Public API ── */

  /**
   * Speak the given text using speechSynthesis.
   * Cancels any ongoing speech first. Reads current prefs on each call.
   * @param {string} text
   */
  function speak(text) {
    if (!TTS_SUPPORTED) return;
    var prefs = loadTTSPrefs();
    if (!prefs.ttsEnabled) return;
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = prefs.ttsRate;
      u.onerror = function (e) {
        // Silently ignore — TTS errors must never block the training flow
        console.warn("[TTS] SpeechSynthesisUtterance error:", e.error);
      };
      window.speechSynthesis.speak(u);
    } catch (err) {
      console.warn("[TTS] speak() failed:", err);
    }
  }

  /**
   * Cancel any ongoing speech immediately.
   */
  function stop() {
    if (!TTS_SUPPORTED) return;
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  }

  /**
   * Returns true if speechSynthesis is available in this browser.
   */
  function isSupported() {
    return TTS_SUPPORTED;
  }

  /**
   * Returns true if TTS is supported AND enabled in current prefs.
   */
  function isEnabled() {
    if (!TTS_SUPPORTED) return false;
    return loadTTSPrefs().ttsEnabled;
  }

  /**
   * Like speak(), but returns a Promise that resolves when the utterance ends
   * (or immediately if TTS is unsupported / disabled / text is empty).
   * Useful when the caller needs to await the end of speech (e.g. advanceTurn).
   * @param {string} text
   * @returns {Promise<void>}
   */
  function speakAsync(text) {
    return new Promise(function (resolve) {
      if (!TTS_SUPPORTED) { resolve(); return; }
      var prefs = loadTTSPrefs();
      if (!prefs.ttsEnabled || !text) { resolve(); return; }
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang  = "zh-CN";
        u.rate  = prefs.ttsRate;
        u.onend   = function () { resolve(); };
        u.onerror = function () { resolve(); };
        window.speechSynthesis.speak(u);
      } catch (err) {
        console.warn("[TTS] speakAsync() failed:", err);
        resolve();
      }
    });
  }

  return {
    speak:       speak,
    speakAsync:  speakAsync,
    stop:        stop,
    isSupported: isSupported,
    isEnabled:   isEnabled,
  };

})();
