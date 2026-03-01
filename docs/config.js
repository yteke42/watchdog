/* ================================================
   Supabase Configuration for PC Monitor Dashboard
   ================================================ */

const SUPABASE_URL = 'https://unaunfiyzmwhrjorupqe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuYXVuZml5em13aHJqb3J1cHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MjgyODksImV4cCI6MjA4MDQwNDI4OX0.FNmRfWS_GLVKvBnSoxxQ6F2GD_DbOr3sDf5R_7ymxUk';

// Auto-refresh interval (ms)
const REFRESH_INTERVAL = 5000; // 5 seconds

// Offline threshold (ms) — if updated_at is older than this, show as offline
const OFFLINE_THRESHOLD = 15 * 60 * 1000; // 15 minutes
