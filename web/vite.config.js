import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use relative paths for Capacitor (mobile) builds, GitHub Pages path for web
const isMobile = process.env.BUILD_TARGET === 'mobile';
const useCustomDomain = !!process.env.CUSTOM_DOMAIN;
export default defineConfig({
  base: isMobile ? './' : useCustomDomain ? '/' : '/discord-crypto-task-payroll-bot/',
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
