/**
 * app.js — Bootstrap, Router, Shared Utilities, Auth, Cloud Sync
 *
 * This file is the first script loaded after supabaseClient.js.
 * It exposes window.APP for use by train.js, dataCenter.js, settings.js.
 *
 * Load order in index.html:
 *   supabaseClient.js → app.js → train.js → dataCenter.js → settings.js
 */

"use strict";

/* ================================================================
   CONSTANTS
   ================================================================ */

const LS_KEY        = "rehab_sessions_v1";
const LS_PREFS_KEY  = "rehab_prefs_v1";
const SAMPLE_AUDIO  = "assets/robot_sample.wav";

/* ================================================================
   SHARED APP NAMESPACE
   ================================================================ */

window.APP = (function () {

  /* ── Auth state ── */
  var authState = {
    user: null,
    cloudSyncEnabled: false,
    modalMode: "login",
  };

  /* ── Routing ── */
  var TABS = ["train", "data", "settings"];

  function navigateTo(tab) {
    if (!TABS.includes(tab)) tab = "train";
    location.hash = "/" + tab;
  }

  function currentTab() {
    var hash = location.hash.replace(/^#\//, "");
    return TABS.includes(hash) ? hash : "train";
  }

  function applyRoute() {
    var tab = currentTab();
    TABS.forEach(function (t) {
      var sec = document.getElementById("section-" + t);
      var btn = document.getElementById("nav-" + t);
      if (sec) sec.hidden = (t !== tab);
      if (btn) {
        btn.classList.toggle("active", t === tab);
        btn.setAttribute("aria-selected", String(t === tab));
      }
    });
    // Notify modules
    if (tab === "data" && typeof window.DC !== "undefined") {
      window.DC.render();
    }
    if (tab === "settings" && typeof window.SETTINGS !== "undefined") {
      window.SETTINGS.renderAccountStatus();
    }
  }

  function initRouter() {
    window.addEventListener("hashchange", applyRoute);
    if (!location.hash || location.hash === "#") {
      location.hash = "/train";
    }
    applyRoute();
  }

  /* ── Utilities ── */

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
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
        day:   "2-digit",
        hour:  "2-digit",
        minute:"2-digit",
      });
    } catch (_) {
      return iso;
    }
  }

  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function generateUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older browsers: uses Math.random() which is not cryptographically
    // secure, but acceptable for client-side session deduplication purposes.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /* ── Status Banner ── */

  function showBanner(type, text) {
    var banner = document.getElementById("status-banner");
    var span   = document.getElementById("status-text");
    if (!banner || !span) return;
    banner.className = "status-banner " + type;
    span.textContent = text;
  }

  /* ── localStorage Session Helpers ── */

  function loadSessions() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function saveSessions(sessions) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(sessions));
    } catch (_) {
      showBanner("warning", "⚠️ 无法保存训练记录（存储空间已满或隐私模式限制）。");
    }
  }

  function markSessionAsSynced(clientSessionId) {
    try {
      var sessions = loadSessions();
      var updated  = sessions.map(function (s) {
        return s.client_session_id === clientSessionId
          ? Object.assign({}, s, { cloud_synced: true })
          : s;
      });
      saveSessions(updated);
    } catch (err) {
      console.warn("[markSessionAsSynced]", err);
    }
  }

  /* ── Auth UI ── */

  function updateAuthUI() {
    var loggedOut = document.getElementById("auth-logged-out");
    var loggedIn  = document.getElementById("auth-logged-in");
    var email     = document.getElementById("auth-user-email");
    var settingsStatus = document.getElementById("settings-auth-status");

    if (authState.user) {
      if (loggedOut) loggedOut.style.display = "none";
      if (loggedIn)  loggedIn.style.display  = "";
      if (email)     email.textContent        = authState.user.email || "";
    } else {
      if (loggedOut) loggedOut.style.display = "";
      if (loggedIn)  loggedIn.style.display  = "none";
    }

    if (settingsStatus && typeof window.SETTINGS !== "undefined") {
      window.SETTINGS.renderAccountStatus();
    }
  }

  function openAuthModal(mode) {
    authState.modalMode = mode || "login";
    var modal = document.getElementById("auth-modal");
    if (modal) modal.style.display = "";
    setAuthModalMode(authState.modalMode);
    var emailEl = document.getElementById("auth-email-input");
    var passEl  = document.getElementById("auth-password-input");
    var errEl   = document.getElementById("auth-modal-error");
    if (emailEl) { emailEl.value = ""; }
    if (passEl)  { passEl.value  = ""; }
    if (errEl)   { errEl.style.display = "none"; }
    setTimeout(function () { if (emailEl) emailEl.focus(); }, 50);
  }

  function closeAuthModal() {
    var modal = document.getElementById("auth-modal");
    if (modal) modal.style.display = "none";
  }

  function setAuthModalMode(mode) {
    authState.modalMode = mode;
    var title     = document.getElementById("auth-modal-title");
    var tabLogin  = document.getElementById("tab-login");
    var tabReg    = document.getElementById("tab-register");
    var btnSubmit = document.getElementById("btn-auth-submit");
    var passEl    = document.getElementById("auth-password-input");

    if (mode === "login") {
      if (title)    title.textContent = "账户登录";
      if (tabLogin) { tabLogin.classList.add("active"); tabLogin.setAttribute("aria-selected", "true"); }
      if (tabReg)   { tabReg.classList.remove("active"); tabReg.setAttribute("aria-selected", "false"); }
      if (btnSubmit) btnSubmit.textContent = "登录";
      if (passEl)   passEl.setAttribute("autocomplete", "current-password");
    } else {
      if (title)    title.textContent = "注册新账户";
      if (tabLogin) { tabLogin.classList.remove("active"); tabLogin.setAttribute("aria-selected", "false"); }
      if (tabReg)   { tabReg.classList.add("active"); tabReg.setAttribute("aria-selected", "true"); }
      if (btnSubmit) btnSubmit.textContent = "注册";
      if (passEl)   passEl.setAttribute("autocomplete", "new-password");
    }
  }

  function showAuthError(msg) {
    var errEl = document.getElementById("auth-modal-error");
    if (errEl) {
      errEl.textContent    = msg;
      errEl.style.display  = "";
    }
  }

  function translateAuthError(msg) {
    if (!msg) return "操作失败，请重试。";
    if (msg.includes("Invalid login credentials"))   return "邮箱或密码错误，请重试。";
    if (msg.includes("Email not confirmed"))         return "邮箱尚未验证，请查收邮件并点击验证链接后再登录。";
    if (msg.includes("User already registered"))     return "该邮箱已注册，请直接登录。";
    if (msg.includes("Password should be at least")) return "密码至少需要 6 位。";
    if (msg.includes("Unable to validate email"))    return "邮箱格式不正确，请检查后重试。";
    return msg;
  }

  /* ── Auth operations ── */

  async function handleRegister() {
    var sb = window.__SUPABASE__;
    if (!sb) { showAuthError("云端服务未加载，请稍后再试。"); return; }

    var emailEl   = document.getElementById("auth-email-input");
    var passEl    = document.getElementById("auth-password-input");
    var btnSubmit = document.getElementById("btn-auth-submit");
    var email     = emailEl ? emailEl.value.trim() : "";
    var password  = passEl  ? passEl.value         : "";
    if (!email || !password) { showAuthError("请填写邮箱地址和密码。"); return; }

    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = "注册中…"; }
    var errEl = document.getElementById("auth-modal-error");
    if (errEl) errEl.style.display = "none";

    var result = await sb.auth.signUp({ email: email, password: password });

    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = "注册"; }

    if (result.error) { showAuthError(translateAuthError(result.error.message)); return; }

    closeAuthModal();
    showBanner("success", "✅ 注册成功！请查收邮箱中的验证邮件，点击链接完成验证后即可登录。");
  }

  async function handleLogin() {
    var sb = window.__SUPABASE__;
    if (!sb) { showAuthError("云端服务未加载，请稍后再试。"); return; }

    var emailEl   = document.getElementById("auth-email-input");
    var passEl    = document.getElementById("auth-password-input");
    var btnSubmit = document.getElementById("btn-auth-submit");
    var email     = emailEl ? emailEl.value.trim() : "";
    var password  = passEl  ? passEl.value         : "";
    if (!email || !password) { showAuthError("请填写邮箱地址和密码。"); return; }

    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.textContent = "登录中…"; }
    var errEl = document.getElementById("auth-modal-error");
    if (errEl) errEl.style.display = "none";

    var result = await sb.auth.signInWithPassword({ email: email, password: password });

    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.textContent = "登录"; }

    if (result.error) { showAuthError(translateAuthError(result.error.message)); return; }

    closeAuthModal();
  }

  async function handleLogout() {
    var sb = window.__SUPABASE__;
    if (!sb) return;
    await sb.auth.signOut();
    showBanner("info", "🚪 已退出登录。");
  }

  /* ── Supabase Auth Init ── */

  async function initAuth() {
    var sb = window.__SUPABASE__;
    if (!sb) return;

    try {
      var result = await sb.auth.getSession();
      var session = result.data && result.data.session;
      if (session) {
        authState.user             = session.user;
        authState.cloudSyncEnabled = true;
        updateAuthUI();
        if (typeof window.DC !== "undefined") window.DC.render();
      }
    } catch (err) {
      console.warn("[initAuth] Failed to restore session:", err);
    }

    sb.auth.onAuthStateChange(function (event, session) {
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
        if (typeof window.DC !== "undefined") window.DC.render();
      } else if (event === "SIGNED_OUT") {
        if (typeof window.DC !== "undefined") window.DC.render();
      }
      if (typeof window.SETTINGS !== "undefined") {
        window.SETTINGS.renderAccountStatus();
      }
    });
  }

  /* ── Cloud Sync ── */

  /**
   * Sync one local session to Supabase.
   * Uses client_session_id to prevent duplicate inserts.
   */
  async function syncSessionToCloud(localSession) {
    if (!authState.cloudSyncEnabled || !authState.user) return false;
    if (!localSession) return false;
    if (localSession.cloud_synced) return true;

    var sb = window.__SUPABASE__;
    if (!sb) return false;

    try {
      var scene_id   = localSession.scene_id || (localSession.turns && localSession.turns[0] && localSession.turns[0].scene_id) || "unknown";
      var clientId   = localSession.client_session_id;

      // Deduplicate: check if client_session_id already exists
      if (clientId) {
        try {
          var checkResult = await sb
            .from("sessions")
            .select("id")
            .eq("client_session_id", clientId)
            .maybeSingle();
          if (!checkResult.error && checkResult.data) {
            // Already synced on cloud
            markSessionAsSynced(clientId);
            return true;
          }
        } catch (_) {
          // Column may not exist yet — proceed with regular insert
        }
      }

      // Build session payload
      var sessionPayload = {
        user_id:    authState.user.id,
        scene_id:   scene_id,
        started_at: localSession.timestamp,
        ended_at:   localSession.timestamp,
        avg_score:  localSession.avg_score,
      };
      if (clientId) {
        sessionPayload.client_session_id = clientId;
      }

      var insertResult = await sb
        .from("sessions")
        .insert(sessionPayload)
        .select("id")
        .single();

      // Graceful fallback: if client_session_id column doesn't exist, retry without it
      if (insertResult.error && clientId) {
        var code = insertResult.error.code;
        if (code === "42703" || (insertResult.error.message && insertResult.error.message.includes("client_session_id"))) {
          delete sessionPayload.client_session_id;
          insertResult = await sb
            .from("sessions")
            .insert(sessionPayload)
            .select("id")
            .single();
        }
      }

      if (insertResult.error) throw insertResult.error;
      var cloudSession = insertResult.data;

      // Insert turns
      if (localSession.turns && localSession.turns.length > 0) {
        var turnsPayload = localSession.turns.map(function (t) {
          return {
            user_id:      authState.user.id,
            session_id:   cloudSession.id,
            robot_text:   t.robot_text   || "",
            recording_ms: t.duration_ms  || 0,
            score:        t.score        || 0,
            label:        t.label        || "unclear",
          };
        });
        var turnsResult = await sb.from("turns").insert(turnsPayload);
        if (turnsResult.error) throw turnsResult.error;
      }

      if (clientId) markSessionAsSynced(clientId);
      return true;

    } catch (err) {
      console.warn("[syncSessionToCloud] Failed:", err);
      return false;
    }
  }

  async function syncAllLocalToCloud() {
    if (!authState.cloudSyncEnabled || !authState.user) {
      showBanner("warning", "⚠️ 请先登录才能将数据同步到云端。");
      return;
    }

    var sessions = loadSessions();
    var unsynced  = sessions.filter(function (s) { return !s.cloud_synced; });

    if (unsynced.length === 0) {
      showBanner("success", "✅ 所有本地数据已同步到云端。");
      return;
    }

    showBanner("info", "☁️ 正在同步 " + unsynced.length + " 条记录，请稍候…");

    var successCount = 0;
    for (var i = 0; i < unsynced.length; i++) {
      var ok = await syncSessionToCloud(unsynced[i]);
      if (ok) successCount++;
    }

    if (successCount === unsynced.length) {
      showBanner("success", "✅ 已成功同步 " + successCount + " 条记录到云端。");
    } else if (successCount > 0) {
      showBanner("warning", "⚠️ 部分同步：" + successCount + " / " + unsynced.length + " 条成功，请稍后重试。");
    } else {
      showBanner("danger", "❌ 同步失败，请检查网络连接后重试。");
    }

    if (typeof window.DC !== "undefined") window.DC.render();
  }

  /* ── Auth Event Listeners ── */

  function initAuthListeners() {
    function on(id, evt, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    }

    on("btn-auth-open",   "click", function () { openAuthModal("login"); });
    on("btn-auth-open-settings", "click", function () { openAuthModal("login"); });
    on("btn-auth-close",  "click", closeAuthModal);
    on("btn-auth-cancel", "click", closeAuthModal);
    on("btn-logout",      "click", handleLogout);
    on("btn-sync-now",    "click", syncAllLocalToCloud);
    on("tab-login",       "click", function () { setAuthModalMode("login"); });
    on("tab-register",    "click", function () { setAuthModalMode("register"); });

    on("btn-auth-submit", "click", function () {
      if (authState.modalMode === "login") {
        handleLogin();
      } else {
        handleRegister();
      }
    });

    on("auth-password-input", "keydown", function (e) {
      if (e.key === "Enter") {
        var btn = document.getElementById("btn-auth-submit");
        if (btn) btn.click();
      }
    });

    var modal = document.getElementById("auth-modal");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeAuthModal();
      });
    }
  }

  /* ── Public API ── */

  return {
    /* Constants */
    LS_KEY:       LS_KEY,
    LS_PREFS_KEY: LS_PREFS_KEY,
    SAMPLE_AUDIO: SAMPLE_AUDIO,

    /* Router */
    navigateTo: navigateTo,
    currentTab: currentTab,

    /* Pending highlight (set by train.js after completion) */
    pendingHighlightId: null,

    /* Utils */
    sleep:         sleep,
    scoreToLabel:  scoreToLabel,
    formatDate:    formatDate,
    escapeHtml:    escapeHtml,
    generateUUID:  generateUUID,
    showBanner:    showBanner,

    /* Storage */
    loadSessions:        loadSessions,
    saveSessions:        saveSessions,
    markSessionAsSynced: markSessionAsSynced,

    /* Auth state (read-only for other modules) */
    get authState() { return authState; },

    /* Auth UI */
    updateAuthUI:   updateAuthUI,
    openAuthModal:  openAuthModal,
    closeAuthModal: closeAuthModal,

    /* Sync */
    syncSessionToCloud:  syncSessionToCloud,
    syncAllLocalToCloud: syncAllLocalToCloud,

    /* Boot */
    init: function () {
      initRouter();
      initAuthListeners();
      initAuth();
    },
  };

})();

/* ================================================================
   BOOT
   ================================================================ */

document.addEventListener("DOMContentLoaded", function () {
  APP.init();
});
