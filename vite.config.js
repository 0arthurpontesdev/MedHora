import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: 'VITE_',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('@firebase/firestore') || id.includes('firebase/firestore')) return 'firebase-firestore';
          if (id.includes('@firebase/auth') || id.includes('firebase/auth')) return 'firebase-auth';
          if (id.includes('@firebase/messaging') || id.includes('firebase/messaging')) return 'firebase-messaging';
          if (id.includes('@firebase/') || id.includes('/firebase/')) return 'firebase-core';
        }
      }
    }
  },
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
