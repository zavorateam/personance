import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: 'all',
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'vendor-three';
          if (id.includes('node_modules/tweakpane')) return 'vendor-tweakpane';
          if (id.includes('node_modules/onnxruntime-web')) return 'vendor-onnx';
        },
      },
    },
  },
});
