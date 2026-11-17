/* Pairwise settings.
   Fill these in to turn on real accounts, cloud backup and shared joint plans (see README).
   Supabase dashboard > Project Settings > API: copy the Project URL and the "anon" "public" key.
   The anon key is meant to be public; your data is protected by the row level security rules in supabase/schema.sql.
   Leave both empty to run the app on this device only, with no server. */
window.PAIRWISE_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};
