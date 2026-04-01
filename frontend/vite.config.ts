import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** 與後端、Docker 共用專案根目錄的 .env（VITE_*） */
const rootDir = path.resolve(__dirname, '..')

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    envDir: rootDir,
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      host: true,
      // 開發時請用 http://localhost:5173 開站；API 請走相對路徑 /api（見 viteApiBase），
      // 由這裡轉發到本機後端，勿在瀏覽器直接打 localhost:3000（除非你有另外開放埠）。
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  }
})
