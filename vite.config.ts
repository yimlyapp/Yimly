import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';
import {defineConfig} from 'vite';
import {legacyCssPlugin} from './vite-plugin-legacy-css';

function fixSafari12LegacyDetector(): any {
  return {
    name: 'fix-safari12-legacy-detector',
    enforce: 'post',
    transformIndexHtml(html: string) {
      return html.replace(
        'import.meta.url;import("_").catch(()=>1);(async function*(){})().next();',
        'import.meta.url;import("_").catch(()=>1);(async function*(){})().next();if(typeof BigInt==="undefined"||typeof globalThis==="undefined")throw new Error("legacy");'
      );
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      legacy({
        targets: ['ios >= 10', 'safari >= 10', 'chrome >= 60'],
        modernTargets: ['safari >= 14', 'ios >= 14', 'chrome >= 80', 'firefox >= 78', 'edge >= 80'],
        modernPolyfills: true,
        renderLegacyChunks: true,
        additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      }),
      fixSafari12LegacyDetector(),
      legacyCssPlugin(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'), // Fix alias to point to src!
      },
    },
    build: {
      outDir: 'dist/client',
      target: 'es2015',
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
