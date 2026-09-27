import { STATS, SERVICES, CERTS, FLEET } from './data.js';

/*
 * HTML статичных блоков. Вызывается из vite.config.js при сборке (и в dev):
 * контент попадает прямо в index.html и виден поисковикам без выполнения JS.
 */

export const SITE_URL = 'https://uzairwaystech.vercel.app';

export const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>';
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/[\s,]/g, ' ');

export const staticBlocks = {
  'services-grid': () =>
    SERVICES.map(([t, d], i) => `<li class="svc"><span class="svc__n">${String(i + 1).padStart(2, '0')}</span><h3>${t}</h3><p>${d}</p></li>`).join(''),
  'certs-grid': () => CERTS.map(([t, d]) => `<div class="cert"><span class="cert__seal">${CHECK_SVG}</span><b>${t}</b><small>${d}</small></div>`).join(''),
  fleet: () => FLEET.map((f) => `<li>${f}</li>`).join(''),
  // итоговое значение в тексте — для поисковиков; счётчик в ui.js анимирует его от нуля
  'stats-grid': () =>
    STATS.map((s) => `<div class="stat"><b data-to="${s.value}" data-suffix="${s.suffix}">${fmt(s.value)}${s.suffix}</b><span>${s.label}</span></div>`).join(''),
};

/** Вставляет блоки в пустые контейнеры с соответствующим id. */
export function fillStatic(html) {
  for (const [id, render] of Object.entries(staticBlocks)) {
    html = html.replace(new RegExp(`(<(\\w+)[^>]*\\bid="${id}"[^>]*>)(</\\2>)`), `$1${render()}$3`);
  }
  return html;
}

/** Структурированные данные schema.org для поисковиков. */
export function jsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${SITE_URL}/#organization`,
    name: 'Uzbekistan Airways Technics',
    alternateName: 'UAT',
    description:
      'Ведущий поставщик услуг по техническому обслуживанию и ремонту воздушных судов в Центральной Азии. EASA Part-145.',
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/logo-uat.png`,
    image: `${SITE_URL}/og-image.jpg`,
    foundingDate: '1924',
    telephone: '+998555031620',
    email: 'uat@uzairways.com',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'ул. Кумарык, 2а',
      addressLocality: 'Ташкент',
      addressRegion: 'Сергелийский район',
      addressCountry: 'UZ',
    },
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: '09:00',
      closes: '18:00',
    },
    areaServed: 'Central Asia',
    parentOrganization: { '@type': 'Organization', name: 'Uzbekistan Airways' },
    knowsAbout: SERVICES.map(([t]) => t),
    hasCredential: CERTS.map(([t, d]) => ({ '@type': 'EducationalOccupationalCredential', name: t, description: d })),
  };
}
