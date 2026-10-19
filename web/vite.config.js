import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.MANAGEMENT_PROXY_URL || 'http://127.0.0.1:8090',
        configure(proxy) {
          proxy.on('proxyReq', (request, incoming) => {
            request.setHeader('X-Real-IP', incoming.socket.remoteAddress || 'local');
          });
        },
      },
    },
  },
  // The crypto WASM must load separately; do not prebundle it into optimizeDeps.
  optimizeDeps: {
    exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
  },
});
