import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em desenvolvimento, o /api é reencaminhado para o backend Flask
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8080' } },
})
