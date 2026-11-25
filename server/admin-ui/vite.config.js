import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: path.resolve(__dirname, '../public/admin'),
    emptyOutDir: false,
    target: 'es2020',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
});
