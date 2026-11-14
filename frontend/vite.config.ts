import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Output to <repo-root>/dist so Vercel's default Vite output directory works
    // without needing an "Output Directory" override in the dashboard.
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      },
      '/tts': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  }
});
