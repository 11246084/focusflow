import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL ?? ''
  if (command === 'build' && apiBase !== '' && apiBase !== '/api/v1') {
    throw new Error('VITE_API_BASE_URL must be empty or /api/v1 for a same-origin build.')
  }
  const proxyTarget = env.VITE_DEV_PROXY_TARGET?.trim() || 'http://127.0.0.1:4000'
  const proxy = { target: proxyTarget, changeOrigin: false, secure: true, headers: { 'ngrok-skip-browser-warning': 'true' } }
  return { plugins: [react()], server: { proxy: { '/api': proxy, '/uploads': proxy } } }
})
