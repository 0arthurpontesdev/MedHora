import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {geminiApiPlugin} from './src/geminiApiPlugin.js';

export default defineConfig({
  plugins: [react(), geminiApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api/status': 'http://127.0.0.1:8787',
      '/api/state': 'http://127.0.0.1:8787',
      '/api/recipient': 'http://127.0.0.1:8787',
      '/api/email': 'http://127.0.0.1:8787'
    }
  }
});
