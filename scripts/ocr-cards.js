// scripts/ocr-cards.js
// OCR por zonas (cardconjurer template, 1500×2100). Extrae efecto + stats.
// Resumable: guarda después de cada carta; re-ejecutar salta lo ya hecho.
// Uso:
//   node scripts/ocr-cards.js
//   node scripts/ocr-cards.js --limit 5
//   node scripts/ocr-cards.js --only arcana
//   node scripts/ocr-cards.js --force

const { createWorker } = require('tesseract.js');
const fs   = require('fs').promises;
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const CARDS_DIR = path.join(ROOT, 'cartas');
const OUTPUT    = path.join(ROOT, 'cards-meta.json');

const args = process.argv.slice(2);
const getArg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const FORCE = args.includes('--force');
const LIMIT = parseInt(getArg('--limit') || '0', 10) || null;
const ONLY  = getArg('--only');
const DEBUG = args.includes('--debug');

// Dimensiones asumidas de la plantilla cardconjurer.
const W = 1500, H = 2100;

// Rectángulos (como porcentajes por si una carta es ligeramente distinta):
// effect-box (texto del efecto, dentro del panel gris inferior)
const RECT_EFFECT = { leftPct: 0.09, topPct: 0.60, widthPct: 0.82, heightPct: 0.26 };
// stat izquierdo (daño) — cajón del dígito
const RECT_STAT_L = { leftPct: 0.060, topPct: 0.870, widthPct: 0.110, heightPct: 0.060 };
// stat derecho (vida) — cajón del dígito
const RECT_STAT_R = { leftPct: 0.830, topPct: 0.870, widthPct: 0.110, heightPct: 0.060 };

function pctToRect(r) {
  return {
    left:   Math.round(r.leftPct   * W),
    top:    Math.round(r.topPct    * H),
    width:  Math.round(r.widthPct  * W),
    height: Math.round(r.heightPct * H),
  };
}

async function walkPngs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walkPngs(full)));
    else if (e.name.toLowerCase().endsWith('.png')) files.push(full);
  }
  return files;
}

const toPosix = p => p.split(path.sep).join('/');

// magia y maniobras nunca llevan stats; el resto puede llevarlos
function cardTypeHasStats(rel) {
  if (rel.startsWith('cartas/magia/'))     return false;
  if (rel.startsWith('cartas/maniobras/')) return false;
  return true;
}

function parseStat(text) {
  const m = (text || '').match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (isNaN(n) || n > 99) return null;
  return n;
}

function cleanEffect(text) {
  const cleaned = (text || '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Si no hay ninguna palabra de ≥4 letras, probablemente es ruido OCR de una
  // caja de efecto vacía.
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}/.test(cleaned)) return '';
  return cleaned;
}

async function main() {
  let absPaths;
  try { absPaths = await walkPngs(CARDS_DIR); }
  catch (e) { console.error(`No puedo leer ${CARDS_DIR}:`, e.message); process.exit(1); }

  const allRels = absPaths.map(p => toPosix(path.relative(ROOT, p))).sort();
  console.log(`Encontradas ${allRels.length} cartas.`);

  let existing = {};
  try { existing = JSON.parse(await fs.readFile(OUTPUT, 'utf8')); } catch {}

  let todo = allRels.filter(rel => {
    if (ONLY && !rel.includes(ONLY)) return false;
    if (FORCE) return true;
    const row = existing[rel];
    return !row || !row.efecto;
  });
  if (LIMIT) todo = todo.slice(0, LIMIT);

  console.log(`Pendientes: ${todo.length}. Saltadas/hechas: ${allRels.length - todo.length}.`);
  if (!todo.length) { console.log('Nada que hacer.'); return; }

  console.log('Inicializando Tesseract (español)...');
  const worker = await createWorker('spa', 1, { logger: () => {} });

  const rectEffect = pctToRect(RECT_EFFECT);
  const rectStatL  = pctToRect(RECT_STAT_L);
  const rectStatR  = pctToRect(RECT_STAT_R);

  const start = Date.now();
  let i = 0;
  for (const rel of todo) {
    i++;
    const abs = path.join(ROOT, rel);
    const t0 = Date.now();
    try {
      // Efecto: rectángulo del panel gris inferior, PSM 6 (bloque uniforme).
      await worker.setParameters({
        tessedit_char_whitelist: '',
        tessedit_pageseg_mode: '6',
      });
      const efectoOcr = (await worker.recognize(abs, { rectangle: rectEffect })).data.text;

      // Stats: solo si la carta puede tenerlos (magia/maniobras nunca tienen).
      const hasStats = cardTypeHasStats(rel);
      let statL = '', statR = '';
      if (hasStats) {
        // Sin whitelist para dar más margen; PSM 6 (bloque) suele acertar más
        // en dígitos grandes aislados con fuente decorativa.
        await worker.setParameters({
          tessedit_char_whitelist: '',
          tessedit_pageseg_mode: '6',
        });
        statL = (await worker.recognize(abs, { rectangle: rectStatL })).data.text;
        statR = (await worker.recognize(abs, { rectangle: rectStatR })).data.text;
      }

      const efecto = cleanEffect(efectoOcr);
      const ataqueOcr = hasStats ? parseStat(statL) : null;
      const vidaOcr   = hasStats ? parseStat(statR) : null;

      // Preservar campos editados por el usuario si ya existen
      const prev = existing[rel] || {};
      existing[rel] = {
        efecto:   prev.efecto   !== undefined && prev.efecto   !== '' ? prev.efecto   : efecto,
        ataque:   prev.ataque   !== undefined ? prev.ataque   : null,
        vida:     prev.vida     !== undefined ? prev.vida     : null,
        // Conjetura OCR para stats (revisa manualmente; suele fallar con fuente decorativa)
        ataqueOcr,
        vidaOcr,
      };
      if (DEBUG) {
        existing[rel]._raw = { efectoOcr, statL: statL.trim(), statR: statR.trim() };
      }

      await fs.writeFile(OUTPUT, JSON.stringify(existing, null, 2));
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[${i}/${todo.length}] ${rel}  ✓ ${dt}s  atkGuess=${ataqueOcr} vidGuess=${vidaOcr}  «${efecto.slice(0, 60)}${efecto.length > 60 ? '…' : ''}»`);
    } catch (e) {
      console.log(`[${i}/${todo.length}] ${rel}  ✗ ${e.message}`);
    }
  }

  await worker.terminate();
  console.log(`\nHecho en ${((Date.now() - start) / 1000).toFixed(1)}s.`);
}

main().catch(e => { console.error(e); process.exit(1); });
