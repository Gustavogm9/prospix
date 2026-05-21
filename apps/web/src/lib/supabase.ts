import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://yvbyplzfqfrlfujathii.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_as07fxROd9RzjqkujuQJAg_7_7nQohw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
