// Tekst uit een screenshot van de Shake-app halen met Tesseract.js (in de browser).
// De bibliotheek staat in vendor/tesseract en wordt pas geladen als er echt een afbeelding wordt geüpload.

const VENDOR = new URL('../vendor/tesseract/', import.meta.url);
const TESSERACT_URL = new URL('tesseract.min.js', VENDOR).href;

let laadPromise = null;
function laadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!laadPromise) {
    laadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error('Kon de tekstherkenning niet laden'));
      document.head.appendChild(s);
    });
  }
  return laadPromise;
}

/**
 * Maak de afbeelding geschikt voor OCR: vergroten en adaptief zwart/wit maken.
 * Tekst is in de Shake-screenshots altijd donkerder dan de (rode/blauwe) achtergrond,
 * dus een lokale drempel (pixel donkerder dan zijn omgeving) haalt de namen eruit.
 */
export function voorbewerk(img) {
  const schaal = img.width < 1400 ? Math.min(3, 1400 / img.width) : 1;
  const w = Math.round(img.width * schaal);
  const h = Math.round(img.height * schaal);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  const beeld = ctx.getImageData(0, 0, w, h);
  const d = beeld.data;

  // Luminantie + integraalbeeld voor een snelle lokale gemiddelde.
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const integraal = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rij = 0;
    for (let x = 1; x <= w; x++) {
      rij += lum[(y - 1) * w + (x - 1)];
      integraal[y * (w + 1) + x] = integraal[(y - 1) * (w + 1) + x] + rij;
    }
  }
  const straal = Math.max(12, Math.round(w / 40));
  const delta = 18;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - straal), y1 = Math.min(h, y + straal + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - straal), x1 = Math.min(w, x + straal + 1);
      const som = integraal[y1 * (w + 1) + x1] - integraal[y0 * (w + 1) + x1] - integraal[y1 * (w + 1) + x0] + integraal[y0 * (w + 1) + x0];
      const gem = som / ((y1 - y0) * (x1 - x0));
      const zwart = lum[y * w + x] < gem - delta;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = zwart ? 0 : 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(beeld, 0, 0);
  return canvas;
}

function laadAfbeelding(bestand) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(bestand);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Afbeelding kon niet worden geopend')); };
    img.src = url;
  });
}

/**
 * Herken tekst in een afbeeldingsbestand.
 * @param {File|Blob} bestand
 * @param {(status: string, voortgang: number) => void} [opVoortgang]
 * @returns {Promise<{ tekst: string, voorbeeld: HTMLCanvasElement }>}
 */
export async function herkenTekst(bestand, opVoortgang = () => {}) {
  opVoortgang('Tekstherkenning laden…', 0);
  const [Tesseract, img] = await Promise.all([laadTesseract(), laadAfbeelding(bestand)]);
  const canvas = voorbewerk(img);
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: new URL('worker.min.js', VENDOR).href,
    corePath: VENDOR.href,
    langPath: new URL('lang/', VENDOR).href,
    logger: (m) => {
      if (m.status === 'recognizing text') opVoortgang('Namen herkennen…', m.progress || 0);
      else if (m.status) opVoortgang('Voorbereiden…', 0);
    },
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzéëïöüèÉ ',
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(canvas);
    return { tekst: data.text, voorbeeld: canvas };
  } finally {
    await worker.terminate();
  }
}
