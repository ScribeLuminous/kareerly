import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://dgnxigotdpqiwohocloi.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Z77o41ry4seJ7opnojlbaA_aiNUFo6B';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
