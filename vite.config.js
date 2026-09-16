import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: 'VITE_',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api/status': 'http://127.0.0.1:8787',
      '/api/state': 'http://127.0.0.1:8787',
      '/api/recipient': 'http://127.0.0.1:8787',
      '/api/email': 'http://127.0.0.1:8787'
    }
  }
});
