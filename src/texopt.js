/*
 * Текстуры моделей — в основном палитры 4×4 цвета, и одно и то же изображение лежит в каждом GLB.
 * Без объединения каждая копия занимает свою текстуру в видеопамяти (57 × 1024² у техников).
 * Здесь одинаковые изображения сводятся к одной текстуре, а плоские карты нормалей убираются.
 */
const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
const N = 32;

export function createTextureOptimizer() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const info = new Map(); // texture.uuid → { key, flat }
  const shared = new Map(); // key → texture

  function inspect(tex) {
    if (info.has(tex.uuid)) return info.get(tex.uuid);
    let r = { key: null, flat: false };
    const img = tex.image;
    try {
      if (img && img.width && !tex.isCompressedTexture) {
        g.clearRect(0, 0, N, N);
        g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        let flat = true;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 128) > 3 || Math.abs(d[i + 1] - 128) > 3 || d[i + 2] < 250) flat = false;
        const params = [img.width, img.height, tex.colorSpace, tex.flipY, tex.wrapS, tex.wrapT, tex.channel, tex.offset.x, tex.offset.y, tex.repeat.x, tex.repeat.y, tex.rotation];
        r = { key: params.join(',') + ':' + Array.from(d).join(','), flat };
      }
    } catch (e) {
      /* изображение недоступно для чтения — текстура остаётся как есть */
    }
    info.set(tex.uuid, r);
    return r;
  }

  return function optimize(root) {
    root.traverse((o) => {
      if (!o.material) return;
      for (const m of [].concat(o.material)) {
        for (const slot of SLOTS) {
          const tex = m[slot];
          if (!tex) continue;
          const { key, flat } = inspect(tex);
          if (slot === 'normalMap' && flat) {
            m.normalMap = null;
            m.needsUpdate = true;
          } else if (key) {
            if (!shared.has(key)) shared.set(key, tex);
            m[slot] = shared.get(key);
          }
        }
      }
    });
  };
}

export const optimizeTextures = createTextureOptimizer();
