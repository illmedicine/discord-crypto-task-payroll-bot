import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deploy base path for GitHub Pages (update repository name if different)
export default defineConfig({
  base: '/discord-crypto-task-payroll-bot/',
  resolve: {
    preserveSymlinks: true,
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
