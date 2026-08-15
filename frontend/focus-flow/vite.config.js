import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const proxyTarget = env.VITE_DEV_PROXY_TARGET?.trim()

  return {
    plugins: [react()],
    server: proxyTarget ? {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
          headers: {
            'ngrok-skip-browser-warning': 'true',
          },
        },
      },
    } : undefined,
  }
})
