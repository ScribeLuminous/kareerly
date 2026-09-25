import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name}. Configure frontend/.env.local or your hosting environment before starting or building.`)
  }
  const url = new URL(env.VITE_SUPABASE_URL!.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('VITE_SUPABASE_URL must be an HTTP(S) URL.')
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim()
  if (command === 'build' && env.VERCEL && !apiBaseUrl) {
    throw new Error('Missing VITE_API_BASE_URL. Set it to your public Cloud Run backend URL in Vercel and redeploy.')
  }
  if (apiBaseUrl) {
    const apiUrl = new URL(apiBaseUrl)
    if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash || !['', '/'].includes(apiUrl.pathname)) {
      throw new Error('VITE_API_BASE_URL must be an HTTP(S) backend origin without /api, credentials, query parameters, or a fragment.')
    }
    if (command === 'build' && env.VERCEL && (apiUrl.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname))) {
      throw new Error('Vercel requires a public HTTPS VITE_API_BASE_URL, such as https://your-service-abc123-as.a.run.app.')
    }
  }
  return { plugins: [react()] }
})
