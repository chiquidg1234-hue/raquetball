/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 100_000_000, // todo inline: el destino es un solo archivo
    cssCodeSplit: false,
    // Un solo chunk: el script de inline de despues lo mete en el HTML.
    codeSplitting: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
});
