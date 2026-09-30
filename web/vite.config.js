import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// MmjGreen web client.
// `/api` is proxied to the MmjGreen Fastify service during local development.
// Production ships `dist/` behind the same Fastify origin (SERVE_WEB=true), so
// the browser only ever makes same-origin API calls — required by the
// strict `connect-src 'self'` Content-Security-Policy.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  },
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:3001' } }
})
