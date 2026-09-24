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
    /**
     * El limite por defecto de vitest son 5 s. Varios tests resuelven el
     * problema inverso, que encadena decenas de simulaciones, y en una
     * maquina cargada eso se pasa del limite y falla un test que no tiene
     * nada que ver con el rendimiento. Los criterios de velocidad reales
     * se miden aparte y de forma explicita; este margen solo evita que la
     * lentitud de la maquina se confunda con una regresion.
     */
    testTimeout: 20_000,
  },
});
