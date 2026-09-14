import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/hub2/',
  server: {
    port: 5179,
    proxy: { '/api': { target: 'http://localhost:3005', changeOrigin: true } },
  },
})
