import { defineConfig } from 'vite';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const reactPlugin = require(path.resolve('node_modules/@vitejs/plugin-react/dist/index.js'));
const react = reactPlugin.default || reactPlugin;

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
