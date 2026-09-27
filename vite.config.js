import { defineConfig } from 'vite';
import { fillStatic, jsonLd } from './src/staticContent.js';

// статичный контент и schema.org прямо в HTML — поисковики видят их без выполнения JS
const seoHtml = () => ({
  name: 'uat-seo-html',
  transformIndexHtml: (html) =>
    fillStatic(html).replace(
      '</head>',
      `  <script type="application/ld+json">${JSON.stringify(jsonLd())}</script>\n  </head>`
    ),
});

export default defineConfig({
  plugins: [seoHtml()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: true },
});
