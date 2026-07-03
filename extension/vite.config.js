import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';

function copyPublicFiles() {
  return {
    name: 'copy-public-files',
    closeBundle() {
      const src = resolve(__dirname, 'public');
      const dest = resolve(__dirname, 'dist');
      if (!existsSync(src)) return;
      const walk = (dir, base) => {
        for (const e of readdirSync(dir)) {
          const f = resolve(dir, e), r = resolve(base, e), d = resolve(dest, r);
          if (statSync(f).isDirectory()) { if (!existsSync(d)) mkdirSync(d, {recursive:true}); walk(f, r); }
          else { mkdirSync(resolve(d,'..'), {recursive:true}); copyFileSync(f, d); }
        }
      };
      walk(src, '.');
    },
  };
}

// JS-only entries (background, content, injected) build via separate Rollup config
import { build as viteBuild } from 'vite';

export default defineConfig({
  plugins: [react(), copyPublicFiles()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        entryFileNames: 'popup/popup.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
  },
  base: '',
});
