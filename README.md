# 脑卒中言语康复训练原型 — 虚拟数字人

A static HTML prototype demonstrating a **stroke-elderly speech rehabilitation training loop** with a virtual streamer-style avatar, lip-sync animation, voice recording, mock intelligibility scoring, and a data centre with trend visualisation.

---

## Directory Structure

```
digital-healthcare/
├── index.html          ← Single-page app entry point (hash-routed)
├── styles.css          ← Elderly-friendly UI styles (+ high-contrast mode)
├── app.js              ← Bootstrap, hash router, shared utils, Supabase auth, cloud sync
├── train.js            ← Scene loading, scene selection, training loop, recording, lip-sync
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

Microphone access requires either **HTTPS** or **localhost**:

```bash
# Python (recommended)
python3 -m http.server 8080
# Open: http://localhost:8080/

# Node.js
npx serve .
```

> **Do NOT open `index.html` directly** (`file://`).  
> The browser blocks microphone access unless served from localhost or HTTPS.

---

## Browser Requirements

| Feature                     | Minimum version                              |
|-----------------------------|----------------------------------------------|
| Web Audio API (lip-sync)    | Chrome 66, Firefox 60, Safari 14.1, Edge 79  |
| MediaRecorder (recording)   | Chrome 47, Firefox 25, Edge 79               |
| MediaDevices.getUserMedia   | All modern browsers on HTTPS/localhost       |
| `crypto.randomUUID`         | Chrome 92, Firefox 95, Safari 15.4           |
| Canvas 2D (trend chart)     | All modern browsers                          |
| Web Speech API (ASR)        | Chrome 33+, Edge 79+ (full); Safari 14.1 (limited); **Firefox: not supported** |

---

## Training Flow

1. Navigate to **#/train** (default).
2. Choose one of the 3 scene cards (买菜 / 问路 / 打电话).
3. For each turn in the scene:
   - Robot "speaks" (mock TTS → sample audio + lip-sync animation)
   - User records voice (MediaRecorder, max 10 s)
   - **Web Speech API** recognises speech in real time (zh-CN, desktop Chrome)
   - Transcript panel appears — user can review, edit, or add keywords
   - User confirms → mock intelligibility scoring → score (0-100) + label + feedback
4. After the last turn, session is saved to `localStorage` and async cloud sync starts.
5. App automatically navigates to **#/data** and highlights the new session row.

---

## ASR — Web Speech API Integration

### How it works

The training loop integrates the browser's native **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) alongside `MediaRecorder`:

1. When the user clicks **开始录音**, both `MediaRecorder` and `SpeechRecognition` start simultaneously.
2. Real-time interim results stream into the ASR transcript panel.
3. When the user clicks **停止录音** (or the 10-second limit is reached), both stop.
4. The **ASR Transcript Panel** appears with the recognised text in an editable textarea.
5. **Keyword quick-pick buttons** (from the current turn's `keywords` list) let the user tap common words to append or correct the text — especially helpful for users with limited typing ability.
6. The user confirms (or edits first) and clicks **✓ 确认并评分** to proceed to scoring.

### `asr_source` values stored per turn

| Value         | Meaning                                                    |
|---------------|------------------------------------------------------------|
| `web_speech`  | Text came from the Web Speech API without manual changes   |
| `manual`      | User edited the textarea or used keyword buttons           |
| `fallback`    | Browser does not support Web Speech API — user typed manually |
| `mock`        | Fallback used inside the dev/test mock path                |

### Manual-input fallback

If `SpeechRecognition` is not available (Firefox, Safari < 14.1, non-Chrome mobile), the panel still appears with an empty textarea so the user can type the answer manually. Training always proceeds regardless of ASR support.

### Local storage

Each turn record stored in `localStorage` (key `rehab_sessions_v1`) includes:

```json
{ "asr_text": "我想买两斤白菜", "asr_source": "web_speech" }
```

These fields are **local-only** at this stage — the Supabase `turns` table schema is unchanged.

### Known limitations

| Limitation | Notes |
|---|---|
| Chrome-only | `webkitSpeechRecognition` is only fully supported in Chrome/Edge. Firefox and Safari show the manual-input fallback. |
| Requires HTTPS or localhost | The browser will block `SpeechRecognition` on `file://` pages. |
| External audio processing | Each call to the Web Speech API sends audio to Google's servers. Do not use for sensitive data in production. |
| Accuracy | zh-CN accuracy is reasonable for clear speech in a quiet environment. Strong accents or dysarthric speech (the target population) may require higher-quality ASR (e.g. Whisper). |
| No audio scoring | Acoustic features (pause duration, speaking rate) currently come from the MediaRecorder blob timestamp, not the ASR API. |

### Upgrading to a higher-accuracy ASR

To replace the Web Speech API with a backend ASR endpoint, modify `handleNext()` in `train.js`. The section that currently reads the confirmed ASR text (around the `state.asrText` check) is the replacement point — upload the recorded blob, get back the transcript, then populate `state.asrText` and `state.asrSource` before the scoring step runs:

```
POST /api/asr
  body: FormData { audio: <Blob>, expected_keywords: [...] }
  resp: { text: string, confidence: number }
```

The rest of the flow (ASR panel display, editing, scoring, storage) requires no changes — the panel can be pre-populated with the backend result and still allow manual correction before confirming.

---

## Mock Scoring Formula

```
score = 100 × (0.5 × confidence + 0.4 × keyword_hit_rate + 0.1 × pace_score)

keyword_hit_rate = matched_keywords / expected_keywords
pace_score       = 1.0 if 0.5 ≤ chars/sec ≤ 4, else degraded
jitter           ±5 pts (random)
```

Labels: **清晰 (≥ 80)** · **一般 (50–79)** · **需改进 (< 50)**

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

Changes apply instantly and persist across page reloads.

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
