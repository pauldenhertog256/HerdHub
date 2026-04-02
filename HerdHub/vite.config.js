import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:5176', changeOrigin: false, followRedirects: false },
      '/images': { target: 'http://localhost:5176', changeOrigin: false },
      '/auth': 'http://localhost:5176',
    },
  },
})
