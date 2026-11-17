/* Pairwise settings.
   Fill these in to turn on real accounts, cloud backup and shared joint plans (see README).
   supabaseUrl:     Supabase > Connect (or Project Settings > Data API) > Project URL
   supabaseAnonKey: Supabase > Project Settings > API Keys > Publishable key (sb_publishable_...),
                    or the legacy "anon public" key on older projects.
   This key is meant to be public; your data is protected by the row level security rules in supabase/schema.sql.
   Never put a Secret key (sb_secret_... or service_role) here.
   Leave both empty to run the app on this device only, with no server. */
window.PAIRWISE_CONFIG = {
  supabaseUrl: 'https://dfqnyjcrxxaayxxmhrev.supabase.co',
  supabaseAnonKey: 'sb_publishable_UuSPjss-F8lmPLiA2Jalmg_9nWtDvWl'
};
