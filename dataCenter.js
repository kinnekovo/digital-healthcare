/**
 * dataCenter.js — Data Center: Trend Chart, History List, Session Details Modal
 *
 * Depends on: app.js (window.APP must be defined first)
 * Exposes:    window.DC
 */

"use strict";

window.DC = (function () {

  /* ── Session Details Modal ── */

  function openModal(session) {
    var modal    = document.getElementById("session-modal");
    var title    = document.getElementById("session-modal-title");
    var content  = document.getElementById("session-modal-content");
    if (!modal || !content) return;

    var date      = APP.formatDate(session.timestamp || session.created_at);
    var sceneName = APP.escapeHtml(session.scene_name || session.scene_names || session.scene_id || "训练");
    var score     = session.avg_score != null ? session.avg_score : "--";
    var label     = APP.scoreToLabel(Number(score) || 0);

    if (title) {
      title.textContent = sceneName + "  " + date;
    }

    // If this is a local session with embedded turns
    if (session.turns && session.turns.length > 0) {
      content.innerHTML = renderTurnsTable(session.turns);
    } else if (session.cloud_id) {
      // Fetch turns from cloud
      content.innerHTML = "<p style='color:var(--color-text-muted);'>正在加载对话详情…</p>";
      modal.style.display = "";
      fetchCloudTurns(session.cloud_id).then(function (turns) {
        content.innerHTML = turns.length > 0
          ? renderTurnsTable(turns)
          : "<p style='color:var(--color-text-muted);'>暂无对话记录。</p>";
      });
      return;
    } else {
      content.innerHTML = "<p style='color:var(--color-text-muted);'>暂无对话详情。</p>";
    }

    modal.style.display = "";
  }

  function closeModal() {
    var modal = document.getElementById("session-modal");
    if (modal) modal.style.display = "none";
  }

  function renderTurnsTable(turns) {
    var rows = turns.map(function (t, i) {
      var score = t.score != null ? t.score : "--";
      var label = APP.scoreToLabel(Number(t.score) || 0);
      var ms    = t.duration_ms || t.recording_ms || 0;
      var dur   = ms > 0 ? (ms / 1000).toFixed(1) + "s" : "--";
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + APP.escapeHtml(t.robot_text || "--") + '</td>' +
        '<td style="text-align:center"><span class="history-score ' + label + '">' + score + '</span></td>' +
        '<td style="text-align:center">' + APP.escapeHtml(t.label ? labelZh(t.label) : "--") + '</td>' +
        '<td style="text-align:center">' + dur + '</td>' +
        '</tr>';
    }).join("");

    return '<table class="turns-table">' +
      '<thead><tr><th>#</th><th>机器人说</th><th>得分</th><th>评级</th><th>时长</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  function labelZh(label) {
    if (label === "clear")   return "清晰";
    if (label === "fair")    return "一般";
    if (label === "unclear") return "需改进";
    return label;
  }

  async function fetchCloudTurns(sessionId) {
    var sb = window.__SUPABASE__;
    if (!sb) return [];
    try {
      var result = await sb
        .from("turns")
        .select("robot_text, recording_ms, score, label")
        .eq("session_id", sessionId)
        .order("id", { ascending: true });
      if (result.error) throw result.error;
      return result.data || [];
    } catch (err) {
      console.warn("[fetchCloudTurns]", err);
      return [];
    }
  }

  /* ── Trend Chart (Canvas) ── */

  function renderTrendChart(sessions) {
    var canvas = document.getElementById("trend-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");

    var W = canvas.width  = canvas.offsetWidth  || 600;
    var H = canvas.height = canvas.offsetHeight || 160;

    ctx.clearRect(0, 0, W, H);

    // Build daily averages for last 30 days
    var now      = new Date();
    var MS_PER_DAY = 86400000;
    var numDays  = 30;
    var days     = [];
    for (var d = numDays - 1; d >= 0; d--) {
      var dt = new Date(now - d * MS_PER_DAY);
      days.push({
        label: (dt.getMonth() + 1) + "/" + dt.getDate(),
        key:   dt.toISOString().slice(0, 10),
        scores: [],
      });
    }

    var dayMap = {};
    days.forEach(function (day) { dayMap[day.key] = day; });

    sessions.forEach(function (s) {
      var ts  = s.timestamp || s.created_at;
      var key = ts ? ts.slice(0, 10) : null;
      if (key && dayMap[key] && s.avg_score != null) {
        dayMap[key].scores.push(Number(s.avg_score));
      }
    });

    var dailyAvgs = days.map(function (day) {
      if (day.scores.length === 0) return null;
      return Math.round(day.scores.reduce(function (a, b) { return a + b; }, 0) / day.scores.length);
    });

    var hasData = dailyAvgs.some(function (v) { return v !== null; });
    if (!hasData) {
      ctx.fillStyle = "#94A3B8";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("暂无数据——完成训练后趋势图将显示在这里", W / 2, H / 2);
      return;
    }

    // Layout
    var padL = 40, padR = 16, padT = 16, padB = 28;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;

    // Grid lines at 0, 25, 50, 75, 100
    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth   = 1;
    [0, 25, 50, 75, 100].forEach(function (v) {
      var y = padT + chartH - (v / 100) * chartH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.stroke();
      ctx.fillStyle = "#94A3B8";
      ctx.font      = "11px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(v, padL - 4, y + 4);
    });

    // X labels (show every 5 days)
    ctx.fillStyle = "#94A3B8";
    ctx.font      = "11px sans-serif";
    ctx.textAlign = "center";
    var step = chartW / (numDays - 1);
    days.forEach(function (day, i) {
      if (i % 5 === 0 || i === numDays - 1) {
        var x = padL + i * step;
        ctx.fillText(day.label, x, H - 4);
      }
    });

    // Connect non-null points with a line
    ctx.strokeStyle = "#2563EB";
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = "round";
    ctx.lineCap     = "round";
    ctx.beginPath();
    var started = false;
    dailyAvgs.forEach(function (v, i) {
      if (v === null) return;
      var x = padL + i * step;
      var y = padT + chartH - (v / 100) * chartH;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else           ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Points
    dailyAvgs.forEach(function (v, i) {
      if (v === null) return;
      var x = padL + i * step;
      var y = padT + chartH - (v / 100) * chartH;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle   = "#2563EB";
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    });
  }

  /* ── Render from Cloud ── */

  function renderCloud(cloudSessions) {
    var totalSessions = cloudSessions.length;
    var avgScore = totalSessions > 0
      ? Math.round(cloudSessions.reduce(function (s, sess) { return s + (Number(sess.avg_score) || 0); }, 0) / totalSessions)
      : 0;

    setStats(totalSessions, "--", totalSessions > 0 ? avgScore : "--");
    renderTrendChart(cloudSessions);

    var list = document.getElementById("history-list");
    if (!list) return;
    list.innerHTML = "";

    if (cloudSessions.length === 0) {
      list.innerHTML = '<li class="history-empty">暂无云端训练记录。完成一次训练后数据将自动同步。</li>';
      return;
    }

    cloudSessions.forEach(function (sess) {
      var score     = Number(sess.avg_score) || 0;
      var label     = APP.scoreToLabel(score);
      var date      = APP.formatDate(sess.created_at || sess.timestamp);
      var sceneName = APP.escapeHtml(sess.scene_name || sess.scene_names || sess.scene_id || "训练");

      var li = document.createElement("li");
      li.className = "history-item";

      // Check highlight
      if (APP.pendingHighlightId && sess.client_session_id === APP.pendingHighlightId) {
        li.classList.add("highlight-new");
      }

      li.innerHTML =
        '<span class="history-score ' + label + '">' + (score > 0 ? score : "--") + '</span>' +
        '<div class="history-meta">' +
          '<div class="scene-name">' + sceneName + '</div>' +
          '<div class="time-info">' + date + '</div>' +
        '</div>' +
        '<span class="sync-indicator cloud" title="云端数据">☁️</span>';

      // Attach click for detail
      li.addEventListener("click", function () {
        openModal({
          timestamp:  sess.created_at || sess.timestamp,
          scene_id:   sess.scene_id,
          scene_name: sceneName,
          avg_score:  sess.avg_score,
          cloud_id:   sess.id,
          turns:      [],
        });
      });
      list.appendChild(li);
    });

    if (APP.pendingHighlightId) {
      var highlighted = list.querySelector(".highlight-new");
      if (highlighted) highlighted.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(function () { APP.pendingHighlightId = null; }, 3000);
    }
  }

  /* ── Render from Local ── */

  function renderLocal() {
    var sessions = APP.loadSessions();

    var totalSessions = sessions.length;
    var totalTurns    = sessions.reduce(function (s, sess) { return s + (sess.turn_count || 0); }, 0);
    var avgScore      = totalSessions > 0
      ? Math.round(sessions.reduce(function (s, sess) { return s + (sess.avg_score || 0); }, 0) / totalSessions)
      : 0;

    setStats(totalSessions, totalTurns, totalSessions > 0 ? avgScore : "--");
    renderTrendChart(sessions);

    var list = document.getElementById("history-list");
    if (!list) return;
    list.innerHTML = "";

    if (sessions.length === 0) {
      list.innerHTML = '<li class="history-empty">暂无训练记录。开始您的第一次训练吧！</li>';
      return;
    }

    sessions.slice(0, 30).forEach(function (sess) {
      var label = sess.avg_label || APP.scoreToLabel(sess.avg_score || 0);
      var date  = APP.formatDate(sess.timestamp);
      var score = sess.avg_score != null ? sess.avg_score : "--";
      var synced = sess.cloud_synced;

      var li = document.createElement("li");
      li.className = "history-item";

      if (APP.pendingHighlightId && sess.client_session_id === APP.pendingHighlightId) {
        li.classList.add("highlight-new");
      }

      li.innerHTML =
        '<span class="history-score ' + label + '">' + score + '</span>' +
        '<div class="history-meta">' +
          '<div class="scene-name">' + APP.escapeHtml(sess.scene_names || sess.scene_name || "训练") + '</div>' +
          '<div class="time-info">' + date + '  ·  ' + (sess.turn_count || 0) + ' 轮对话</div>' +
        '</div>' +
        '<span class="sync-indicator ' + (synced ? "cloud" : "local") + '" title="' + (synced ? "已同步到云端" : "仅本地") + '">' +
          (synced ? "☁️" : "📱") +
        '</span>';

      li.addEventListener("click", function () { openModal(sess); });
      list.appendChild(li);
    });

    if (APP.pendingHighlightId) {
      var highlighted = list.querySelector(".highlight-new");
      if (highlighted) highlighted.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(function () { APP.pendingHighlightId = null; }, 3000);
    }
  }

  function setStats(sessions, turns, avgScore) {
    var s = document.getElementById("stat-sessions");
    var t = document.getElementById("stat-turns");
    var a = document.getElementById("stat-avg-score");
    if (s) s.textContent = sessions;
    if (t) t.textContent = turns;
    if (a) a.textContent = avgScore;
  }

  /* ── Main Render ── */

  async function render() {
    var authState = APP.authState;
    if (authState.cloudSyncEnabled && authState.user) {
      var sb = window.__SUPABASE__;
      if (sb) {
        try {
          var result = await sb
            .from("sessions")
            .select("id, scene_id, scene_name, avg_score, created_at, client_session_id")
            .eq("user_id", authState.user.id)
            .order("created_at", { ascending: false })
            .limit(50);

          if (!result.error && result.data) {
            renderCloud(result.data);
            return;
          }
        } catch (err) {
          console.warn("[DC.render] Cloud fetch failed, falling back:", err);
        }
      }
    }
    renderLocal();
  }

  /* ── Init ── */

  function init() {
    // Modal close buttons
    var closeBtn = document.getElementById("session-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    var modal = document.getElementById("session-modal");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
      });
    }
    // Initial render when data section is already visible
    if (APP.currentTab() === "data") render();
  }

  return {
    init:   init,
    render: render,
  };

})();

document.addEventListener("DOMContentLoaded", function () {
  DC.init();
});
