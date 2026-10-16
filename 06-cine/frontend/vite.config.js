import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // El contrato dice que el frontend corre en http://localhost:3000
  server: { port: 3000, strictPort: true },
})
