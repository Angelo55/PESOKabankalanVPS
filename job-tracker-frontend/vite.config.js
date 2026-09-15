import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Default 4173 falls inside a Windows-reserved port range (WinNAT/Hyper-V),
  // which makes `vite preview` fail with EACCES. Use a port outside those ranges.
  preview: {
    port: 4300,
  },
})
