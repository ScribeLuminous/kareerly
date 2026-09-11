import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name}. Configure frontend/.env.local or your hosting environment before starting or building.`)
  }
  const url = new URL(env.VITE_SUPABASE_URL!.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('VITE_SUPABASE_URL must be an HTTP(S) URL.')
  return { plugins: [react()] }
})
