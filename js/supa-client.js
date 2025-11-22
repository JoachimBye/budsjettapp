(function () {
  const SUPABASE_URL = 'https://mmeitnqbnphuabnyamns.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZWl0bnFibnBodWFibnlhbW5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3ODAzNDUsImV4cCI6MjA3ODM1NjM0NX0.qewZdwM-yfIBKMr-MUuLKX-fpfCy0Gw8agronvVzONY';

  let supaInstance = null;

  function getSupabaseClient() {
    if (supaInstance) return supaInstance;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.error('Supabase JS client missing');
      return null;
    }
    supaInstance = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supaInstance;
  }

  window.supaClient = Object.freeze({
    getClient: getSupabaseClient,
  });
})();
