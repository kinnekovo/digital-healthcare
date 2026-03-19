/* supabaseClient.js — Supabase browser client
   Non-module script: initializes the Supabase JS v2 SDK and attaches
   the client instance to window.__SUPABASE__ for use by app.js.
   Must be loaded AFTER the Supabase CDN script and BEFORE app.js.

   Note: The SUPABASE_ANON_KEY is the "anon public" key designed for
   client-side use and is safe to commit. It only allows operations
   permitted by Row Level Security policies. Never commit the
   service_role key.
*/
(function () {
  "use strict";

  var SUPABASE_URL = "https://mrxubtsdkfotyjuzwjtj.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yeHVidHNka2ZvdHlqdXp3anRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzQ0OTQsImV4cCI6MjA4OTQxMDQ5NH0._ZJz1EHDWbb-fs_KCxTk9WxHgFmsmOdY-OqrqR1ENqw";

  if (
    typeof window !== "undefined" &&
    window.supabase &&
    typeof window.supabase.createClient === "function"
  ) {
    try {
      window.__SUPABASE__ = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
      );
    } catch (e) {
      console.warn("[supabaseClient] Failed to initialize Supabase client:", e);
    }
  } else {
    console.warn(
      "[supabaseClient] Supabase JS SDK not loaded — cloud sync will be unavailable."
    );
  }
})();
