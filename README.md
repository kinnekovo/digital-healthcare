# 脑卒中言语康复训练原型 — 虚拟数字人

A static HTML prototype demonstrating a **stroke-elderly speech rehabilitation training loop** with a virtual streamer-style avatar, lip-sync animation, Web Speech API ASR (recording flow), deterministic explainable intelligibility scoring (V1), and a data centre with trend visualisation.

---

## Directory Structure

```
digital-healthcare/
├── index.html          ← Single-page app entry point (hash-routed)
├── styles.css          ← Elderly-friendly UI styles (+ high-contrast mode)
├── app.js              ← Bootstrap, hash router, shared utils, Supabase auth, cloud sync
├── train.js            ← Scene loading, scene selection, training loop, ASR recording flow, lip-sync
├── dataCenter.js       ← Trend chart, history list, session details modal
├── settings.js         ← Preferences (font size, high contrast), account status
├── scenes.json         ← Scene scripts (3 scenes; edit here to add/change dialogue)
├── supabaseClient.js   ← Supabase JS client init (anon key only)
├── assets/
│   ├── avatar.svg          ← Placeholder 2D avatar (SVG, animatable mouth)
│   └── robot_sample.wav    ← Placeholder 440 Hz tone (replace with real TTS audio)
└── README.md           ← This file
```

---

## Navigation (Hash Routing)

The app uses hash-based in-page routing — no server redirects required:

| URL hash    | Tab          | Description                                       |
|-------------|--------------|---------------------------------------------------|
| `#/train`   | 🏋️ 训练      | Scene selection grid + training loop (default)    |
| `#/data`    | 📈 数据中心  | Trend chart, history list, session details        |
| `#/settings`| ⚙️ 设置     | Font size, high contrast, account & sync status   |

Default route: `https://kinnekovo.github.io/digital-healthcare/` → auto-redirects to `#/train`.

---

## Scene Scripts (`scenes.json`)

Scenes are loaded from `scenes.json` at startup; if the fetch fails the app falls back to a built-in copy.

### Format

```jsonc
{
  "scenes": [
    {
      "id":    "grocery",       // unique ID (used as scene_id in database)
      "name":  "买菜",           // display name
      "icon":  "🛒",            // emoji icon shown on selection card
      "turns": [
        {
          "robot_text": "您好！今天想去超市买什么菜呀？",   // robot utterance (TTS input)
          "hint":       "试着说：白菜、萝卜、土豆……",       // hint shown below subtitle
          "keywords":   ["菜","买","白菜","萝卜","土豆"]   // keywords for scoring
        }
        // … more turns
      ]
    }
    // … more scenes
  ]
}
```

**Current scenes:**

| ID           | Name   | Icon | Turns |
|--------------|--------|------|-------|
| `grocery`    | 买菜   | 🛒   | 3     |
| `directions` | 问路   | 🗺️  | 3     |
| `phone`      | 打电话 | 📞  | 3     |

To add a scene, append an object to the `scenes` array. No JS changes required.

---

## How to Run Locally

Web Speech API requires either **HTTPS** or **localhost** (same as MediaDevices):

```bash
# Python (recommended)
python3 -m http.server 8080
# Open: http://localhost:8080/

# Node.js
npx serve .
```

> **Do NOT open `index.html` directly** (`file://`).  
> The browser blocks `SpeechRecognition` unless served from localhost or HTTPS.

---

## Browser Requirements

| Feature                     | Minimum version                              |
|-----------------------------|----------------------------------------------|
| Web Audio API (lip-sync)    | Chrome 66, Firefox 60, Safari 14.1, Edge 79  |
| `crypto.randomUUID`         | Chrome 92, Firefox 95, Safari 15.4           |
| Canvas 2D (trend chart)     | All modern browsers                          |
| Web Speech API (ASR)        | **Chrome 33+ / Edge 79+ (full support)**; Safari 14.1 (limited); **Firefox: not supported** — recognition is skipped, confirm with empty result is still allowed |

---

## Training Flow

1. Navigate to **#/train** (default).
2. Choose one of the 3 scene cards (买菜 / 问路 / 打电话).
3. For each turn in the scene:
   - Robot "speaks" via TTS (Web Speech Synthesis) if supported and enabled, or plays the sample audio as a fallback; lip-sync animation plays during sample audio playback
   - **ASR panel** appears — tap **🎙️ 开始录音** to start speech recognition
   - Speak naturally; real-time partial transcript appears in the display box
   - Tap **⏹ 停止录音** — status changes to **⏳ 识别中…** while the engine finalises
   - If recognized: transcript shown, **✓ 确认并评分** becomes enabled
   - If not recognized / error: fallback panel shows **🔄 再试一次** (big button)
   - User confirms → mock intelligibility scoring → score (0–100) + label + feedback
4. After the last turn, session is saved to `localStorage` and async cloud sync starts.
5. App automatically navigates to **#/data** and highlights the new session row.

---

## ASR — Web Speech API (方案1: Recording Flow)

### How it works

The training loop uses the browser's native **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) as the **sole** input method. There is no manual text field and no keyword fallback.

| Parameter | Value |
|---|---|
| `lang` | `zh-CN` |
| `continuous` | `false` (single-utterance per session) |
| `interimResults` | `true` (live partial transcript shown) |
| `maxAlternatives` | `1` |

**Turn flow:**
1. Robot prompt plays.
2. ASR panel appears showing status *(等待开始…)*.
3. User taps **🎙️ 开始录音** — user gesture triggers `recognition.start()`.
4. Live interim transcript streams into the read-only display box.
5. User taps **⏹ 停止录音** → status shows **⏳ 识别中…** while recognition finalises.  
   `onend` resolves the result:
   - **Success (text received)**: status → *✅ 识别完成*; **✓ 确认并评分** becomes enabled.
   - **Failure / empty**: fallback panel shows **🔄 再试一次** (large button); **✓ 确认并评分** is still enabled so the user can proceed with an empty transcript.
6. User taps **✓ 确认并评分** → scoring → feedback.

### Failure handling

When ASR fails or returns empty text, a fallback panel shows **instead of a typing field or keyword chips**:

- **🔄 再试一次** — resets the panel so the user can record again from scratch.
- **✓ 确认并评分** — still enabled; proceeding with no text gives a low score but keeps the training loop moving.

### `asr_source` values stored per turn

| Value | Meaning |
|---|---|
| `speech` | Final transcript from Web Speech API |
| `none` | Recognition failed or returned empty; turn confirmed with no text |

### Compatibility

| Browser | Behavior |
|---|---|
| Chrome ≥ 33 (desktop) | Full ASR support |
| Edge ≥ 79 (desktop) | Full ASR support (uses same Chromium engine) |
| Safari | Limited / inconsistent — may return empty; retry or confirm with empty |
| Firefox | Not supported — confirm with empty transcript is allowed |

If `SpeechRecognition` is not detected, a one-time warning banner is shown and the ASR panel immediately shows an error with **🔄 再试一次** and **✓ 确认并评分** enabled — training can always be completed.

### Local storage

Each turn record stored in `localStorage` (key `rehab_sessions_v1`) includes:

```json
{
  "asr_text": "我想买两斤白菜",
  "asr_source": "speech",
  "duration_ms": 4200
}
```

For turns where recognition failed or was not available:

```json
{
  "asr_text": "",
  "asr_source": "none",
  "duration_ms": 0
}
```

These fields are **local-only** — the Supabase `turns` table schema is unchanged.

### Known limitations

| Limitation | Notes |
|---|---|
| Chrome/Edge desktop only | `webkitSpeechRecognition` is only fully supported in Chrome/Edge. Other browsers auto-fallback to keyword mode. |
| Requires HTTPS or localhost | The browser blocks `SpeechRecognition` on `file://` pages. |
| External audio processing | The Web Speech API sends audio to Google's servers. Do not use for sensitive data in production. |
| Accuracy | zh-CN accuracy is reasonable for clear speech in a quiet environment. Dysarthric speech (the target population) may require higher-quality ASR (e.g. Whisper via backend). |

### Upgrading to a higher-accuracy ASR

To replace the Web Speech API with a backend ASR endpoint, modify `doScoring()` in `train.js`:

```
POST /api/asr
  body: FormData { audio: <Blob>, expected_keywords: [...] }
  resp: { text: string, confidence: number }
```

Populate `state.asrText`, `state.asrSource = "speech"`, and `state.asrConfidence` before calling `doScoring()`. The rest of the flow (scoring, storage) requires no changes.

---

## Scoring Algorithm (V1 — Deterministic, Explainable)

The scoring algorithm is fully deterministic: the same spoken answer always produces the same score.

```
score = clamp(0..100,
  round(
    100 × (0.60 × hitRate + 0.25 × lenScore + 0.15 × paceScore)
    + confidenceAdjust
  )
)
```

### Inputs

| Input | Source |
|---|---|
| `asrText` | Final transcript from Web Speech API |
| `confidence` | ASR confidence (0–1); default 0.75 when unavailable |
| `keywords` | `turn.keywords` from `scenes.json` |
| `durationMs` | Recording duration in milliseconds |

### Components

| Component | Formula | Weight |
|---|---|---|
| `hitRate` | Normalised substring matches ÷ total keywords; 0.6 if no keywords configured | 60% |
| `lenScore` | `min(1, normalizedChars / 8)` — 8+ chars = full score | 25% |
| `paceScore` | 1.0 if 1.0–4.0 chars/sec; piecewise linear below/above | 15% |
| `confidenceAdjust` | `(conf - 0.75) * 32` -> +-8 pts max | additive |

**Normalisation**: whitespace, fullwidth spaces, and common Chinese/English punctuation are stripped before matching.

**Empty transcript**: score fixed at **20**, label `unclear`, tip suggests retry.

### Labels

**清晰 (≥ 80)** · **一般 (50–79)** · **需改进 (< 50)**

### Feedback priority

Issues are reported in order of importance:
1. Missing keywords (`hitRate < 0.5`) — lists up to 3 missing keywords
2. Content too short (< 4 normalised chars)
3. Pace too fast or too slow
4. Otherwise: positive feedback

---

## Data Centre Features

- **Trend chart**: Canvas-based line chart of daily average scores for the last 30 days (no external libraries).
- **History list**: Session rows with date/time, scene name, avg score, turn count, cloud/local sync indicator (☁️/📱).
- **Session details modal**: Click any history row to see per-turn breakdown (robot_text, score, label, duration). Cloud sessions fetch turns on demand.
- **Data source**: Logged-in → prefer cloud sessions; offline/logged-out → localStorage fallback.

---

## Settings

Preferences are stored in `localStorage` under key `rehab_prefs_v1`:

| Key            | Values              | Default | Effect                                 |
|----------------|---------------------|---------|----------------------------------------|
| `fontScale`    | `1.0`, `1.1`, `1.2` | `1.0`   | Scales root font-size proportionally   |
| `highContrast` | `true` / `false`    | `false` | Switches to dark high-contrast palette |
| `ttsEnabled`   | `true` / `false`    | `true`  | Enables / disables robot TTS           |
| `ttsRate`      | `0.9`, `1.0`, `1.1` | `1.0`   | Speech rate (slow / standard / fast)   |

Changes apply instantly and persist across page reloads.

---

## TTS — Web Speech Synthesis API

The app uses the browser's built-in **Web Speech Synthesis API** (`speechSynthesis`) to read each robot prompt aloud, at zero cost and with no backend dependency.

### How it works

- When a new turn starts, the robot's `robot_text` is automatically spoken via `speechSynthesis` (language: `zh-CN`).
- The **🔊 播放机器人** button (always visible during a turn) replays the current sentence at any time — it uses TTS when supported and enabled, and falls back to the placeholder sample audio otherwise.
- When the user taps **🎙️ 开始录音**, any ongoing TTS is immediately cancelled (`speechSynthesis.cancel()`) to prevent interference with ASR.
- TTS never blocks the UI. All errors are caught silently so training can always continue.

### Disabling TTS

Go to **⚙️ 设置 → 语音朗读（TTS）** and toggle off **"朗读机器人台词"**.  
The setting is saved immediately and persists after reload.

### Known browser limitations

| Browser | Behaviour |
|---------|-----------|
| Chrome ≥ 33 (desktop) | Full support — auto-speaks on turn start |
| Edge ≥ 79 (desktop) | Full support |
| Safari (iOS / macOS) | Supported but **requires a prior user gesture** — the first auto-speak may be silently skipped; use **🔊 播放机器人** to replay manually |
| Firefox | `speechSynthesis` supported but voice availability varies; may require user gesture |

> **Note**: Some browsers block `speechSynthesis.speak()` on page load or after inactivity without a preceding user interaction. The **🔊 播放机器人** button always works because it is triggered by a click.

If `speechSynthesis` is not available, the TTS controls in Settings are hidden and a note is shown. The app remains fully functional without TTS.

---

## `client_session_id` — Session Deduplication

Every training session generates a `client_session_id` (UUID via `crypto.randomUUID()`).

- Stored in the `localStorage` session object.
- Included in the Supabase `sessions` row insert (see migration SQL below).
- On **Sync Now**, before inserting, the app checks if `client_session_id` already exists on the cloud — preventing duplicate rows when the button is clicked multiple times.
- After training completes, `client_session_id` is used to highlight the new session row in the Data Centre list.

### Graceful degradation

If the `client_session_id` column does not yet exist on the `sessions` table, the app detects PostgreSQL error `42703` (undefined column) and retries the insert without the column — sync still works, deduplication is skipped.

---

## Supabase Auth + Cloud Sync

### Project configuration

| Setting     | Value                                       |
|-------------|---------------------------------------------|
| Project URL | `https://mrxubtsdkfotyjuzwjtj.supabase.co`  |
| Anon key    | See `supabaseClient.js` (safe for front-end) |

> **⚠️ Never expose the `service_role` key** in any client-side file or version control.

### Authentication → URL Configuration

- **Site URL**: `https://kinnekovo.github.io/digital-healthcare/`
- **Redirect URLs**: `https://kinnekovo.github.io/digital-healthcare/`

### Database schema

```sql
-- sessions table (existing)
CREATE TABLE IF NOT EXISTS public.sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scene_id   TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ,
  avg_score  NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions_select_own" ON public.sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sessions_insert_own" ON public.sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- turns table (existing)
CREATE TABLE IF NOT EXISTS public.turns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id   UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  robot_text   TEXT NOT NULL,
  recording_ms INTEGER NOT NULL DEFAULT 0,
  score        INTEGER NOT NULL,
  label        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.turns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "turns_select_own" ON public.turns
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "turns_insert_own" ON public.turns
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

### Migration — add `client_session_id` column (NEW)

Run this once in the Supabase SQL editor to enable full deduplication:

```sql
-- Add client_session_id column to sessions
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS client_session_id TEXT;

-- Unique index (NULL values are excluded, so old rows without the column are unaffected)
CREATE UNIQUE INDEX IF NOT EXISTS sessions_client_session_id_unique
  ON public.sessions (client_session_id)
  WHERE client_session_id IS NOT NULL;

-- Optional: add scene_name for richer display in Data Centre
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS scene_name TEXT;
```

RLS impact: existing `sessions_insert_own` and `sessions_select_own` policies are unchanged — they use `auth.uid() = user_id`, which is column-independent.

---

## How to Replace Placeholder Assets

### Sample Audio

```python
import wave, array, math
rate = 22050
samples = [int(32767 * 0.5 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(rate)]
with wave.open("assets/robot_sample.wav", "w") as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate)
    f.writeframes(array.array("h", samples).tobytes())
```

### Avatar Image

1. Create a 200×260 SVG with your character artwork.
2. Add `<ellipse id="mouth-open" cx="..." cy="..." rx="14" ry="0" fill="#8B2020"/>` at the mouth position.
3. Replace `assets/avatar.svg`.

---

## Integrating FastAPI + Real ASR/TTS

The mock/browser functions in `train.js` are the integration points:

```
MOCK_TTS(text)                   → POST /api/tts
                                     body: { text }
                                     resp: { audio_url }

handleNext() — state.asrText     → POST /api/asr          (replace the Web Speech API path)
                                     body: FormData { audio: <Blob>, expected_keywords: [...] }
                                     resp: { text, confidence }
                                     (pre-populate state.asrText + state.asrConfidence, then confirm)

MOCK_SCORE(text, conf, kw, dur)  → POST /api/score
                                     body: { asr_text, confidence, expected_keywords, duration_ms }
                                     resp: { score, label, feedback, tip }
```

Unified response envelope: `{ "code": 200, "msg": "ok", "data": { ... } }`

---

## Security & Privacy Notes

- All audio processing is client-side in this prototype. No data leaves the browser.
- `localStorage` data is origin-scoped. Clear with `localStorage.removeItem("rehab_sessions_v1")`.
- When integrating real ASR/TTS services, handle audio data per applicable privacy regulations.
