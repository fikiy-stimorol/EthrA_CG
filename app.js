const { createApp, ref, reactive, computed, watch, onMounted, nextTick } = Vue;
const db      = window.db;
const auth    = window.auth;
const storage = window.storage;

// ── Card Renderer ─────────────────────────────────────────────────
// Todos los marcos miden 1500x2100. Las coordenadas son las mismas para
// los 6 marcos (mismo template). Lo que cambia es la paleta y si tienen
// los huecos de stats abajo.
const CARD_W = 1500, CARD_H = 2100;

const FRAMES = {
  'Magia':             { hasStats: false, file: 'Magia.png' },
  'Maniobra':          { hasStats: false, file: 'Maniobra.png' },
  'Objeto-desechable': { hasStats: false, file: 'Objeto-desechable.png' },
  'Heroe':             { hasStats: true,  file: 'Heroe.png' },
  'Esbirro':           { hasStats: true,  file: 'Esbirro.png' },
  'Objeto':            { hasStats: true,  file: 'Objeto.png' },
};

// bbox de cada zona en coordenadas del lienzo 1500x2100.
// La zona del arte cubre TODO el hueco transparente del marco (medido en
// Esbirro.png: x=40-1460, y=210-1230). El frame se dibuja encima y recorta
// lo que sobresalga, así que pasarse por dentro es seguro y elimina margen.
// atk/hp/type están alineados con los `<>` del marco (y≈[1875, 1965]).
const LAYOUT = {
  art:    { x: 40,   y: 210,  w: 1420, h: 1020 },
  name:   { x: 200,  y: 80,   w: 1100, h: 130 },
  effect: { x: 150,  y: 1310, w: 1200, h: 540 },
  type:   { x: 290,  y: 1870, w: 920,  h: 100 },
  atk:    { x: 110,  y: 1875, w: 180,  h: 90 },
  hp:     { x: 1210, y: 1875, w: 180,  h: 90 },
};

// Color del texto según el marco. El nombre y las estadísticas siempre en
// blanco; el efecto y el tipo se ajustan al marco para mejor contraste.
const FRAME_TEXT_COLOR = {
  'Heroe':             { name: '#ffffff', type: '#ffffff', effect: '#f8eecf' },
  'Esbirro':           { name: '#ffffff', type: '#ffffff', effect: '#f5e6e6' },
  'Magia':             { name: '#ffffff', type: '#ffffff', effect: '#f0f4ff' },
  'Maniobra':          { name: '#ffffff', type: '#ffffff', effect: '#f5f5f5' },
  'Objeto':            { name: '#ffffff', type: '#ffffff', effect: '#f0f0f4' },
  'Objeto-desechable': { name: '#ffffff', type: '#ffffff', effect: '#f0f0f4' },
};

// Cache de imágenes (frames + arts) para no descargar en cada pintada
const _imgCache = new Map();
function loadImage(src) {
  if (_imgCache.has(src)) return _imgCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  _imgCache.set(src, p);
  return p;
}

// Ajusta tamaño de fuente para que `text` quepa en `maxWidth` con la fuente dada.
// Devuelve el px size que entra (no menor que `minPx`).
function fitSingleLine(ctx, text, font, maxPx, minPx, maxWidth) {
  let size = maxPx;
  while (size > minPx) {
    ctx.font = `${size}px ${font}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minPx;
}

// Wrap por palabras. Devuelve array de líneas.
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Encuentra el mayor px (entre min..max) que permite que el efecto entre en
// el panel respetando el wrap.
function fitMultiline(ctx, text, font, maxPx, minPx, maxWidth, maxHeight, lineHeightFactor = 1.18) {
  let size = maxPx;
  while (size >= minPx) {
    ctx.font = `${size}px ${font}`;
    const lines = wrapText(ctx, text, maxWidth);
    const totalH = lines.length * size * lineHeightFactor;
    if (totalH <= maxHeight) return { size, lines };
    size -= 2;
  }
  ctx.font = `${minPx}px ${font}`;
  return { size: minPx, lines: wrapText(ctx, text, maxWidth) };
}

// Dibuja `art` recortado (cover) en el bbox dado.
function drawArtCover(ctx, art, box) {
  const r = Math.max(box.w / art.width, box.h / art.height);
  const w = art.width * r, h = art.height * r;
  const dx = box.x + (box.w - w) / 2;
  const dy = box.y + (box.h - h) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.drawImage(art, dx, dy, w, h);
  ctx.restore();
}

// Pinta una carta completa en el canvas dado.
// opts: { canvas, frameKey, artUrl, nombre, efecto, tipo, subtipo, ataque, vida }
async function renderCardCanvas(opts) {
  const canvas = opts.canvas;
  const ctx    = canvas.getContext('2d');
  canvas.width  = CARD_W;
  canvas.height = CARD_H;
  // Fondo opaco: las esquinas redondeadas del marco son transparentes (RGBA
  // 0,0,0,0). Sin este relleno, en Tabletop Simulator (y otras apps que
  // muestren el PNG sobre cualquier color) las esquinas dejarían pasar el
  // fondo. Negro coincide con el aspecto del resto de cartas del juego.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const frame = FRAMES[opts.frameKey] || FRAMES['Magia'];
  const colors = FRAME_TEXT_COLOR[opts.frameKey] || FRAME_TEXT_COLOR['Magia'];

  // 1) arte (debajo del marco, recortado al hueco central)
  if (opts.artUrl) {
    try {
      const art = await loadImage(opts.artUrl);
      drawArtCover(ctx, art, LAYOUT.art);
    } catch (e) { /* sin arte, mostramos solo marco */ }
  }

  // 2) marco encima
  const frameImg = await loadImage(frame.file);
  ctx.drawImage(frameImg, 0, 0, CARD_W, CARD_H);

  // 3) Nombre (Quango, ajuste al ancho)
  if (opts.nombre) {
    ctx.fillStyle = colors.name;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = fitSingleLine(ctx, opts.nombre, 'Quango', 72, 36, LAYOUT.name.w);
    ctx.font = `${size}px Quango`;
    ctx.fillText(opts.nombre, LAYOUT.name.x + LAYOUT.name.w / 2, LAYOUT.name.y + LAYOUT.name.h / 2);
  }

  // 4) Efecto (Montserrat, multilínea, centrado)
  if (opts.efecto) {
    ctx.fillStyle = colors.effect;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const fit = fitMultiline(ctx, opts.efecto, '"Montserrat", sans-serif', 50, 26,
                              LAYOUT.effect.w, LAYOUT.effect.h, 1.22);
    ctx.font = `${fit.size}px "Montserrat", sans-serif`;
    const lineH = fit.size * 1.22;
    const totalH = fit.lines.length * lineH;
    const startY = LAYOUT.effect.y + (LAYOUT.effect.h - totalH) / 2;
    fit.lines.forEach((line, i) => {
      ctx.fillText(line, LAYOUT.effect.x + LAYOUT.effect.w / 2,
                   startY + i * lineH);
    });
  }

  // 5) Tipo - Subtipo (Quango)
  const typeStr = [opts.tipo, opts.subtipo].filter(Boolean).map(cap).join(' - ');
  if (typeStr) {
    ctx.fillStyle = colors.type;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = fitSingleLine(ctx, typeStr, 'Quango', 56, 28, LAYOUT.type.w);
    ctx.font = `${size}px Quango`;
    ctx.fillText(typeStr, LAYOUT.type.x + LAYOUT.type.w / 2, LAYOUT.type.y + LAYOUT.type.h / 2);
  }

  // 6) Ataque / Vida (solo en marcos con stats), siempre en blanco
  if (frame.hasStats) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const drawStat = (val, box) => {
      if (val === null || val === undefined || val === '') return;
      const text = String(val);
      const size = fitSingleLine(ctx, text, 'Quango', 70, 36, box.w * 0.7);
      ctx.font = `${size}px Quango`;
      ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2);
    };
    drawStat(opts.ataque, LAYOUT.atk);
    drawStat(opts.vida,   LAYOUT.hp);
  }
}

// Convierte el canvas a Blob PNG.
function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob falló')), 'image/png');
  });
}

// Firestore doc id ← cardId ("magia/arcana/Anular (6)" → "magia__arcana__Anular (6)")
function metaDocId(cardId)   { return cardId.replace(/\//g, '__'); }
function cardIdFromDoc(docId) { return docId.replace(/__/g, '/'); }

// "cartas/magia/arcana/Anular (6).png" → "magia/arcana/Anular (6)"
function pathToCardId(path) {
  return path.replace(/^cartas\//, '').replace(/\.png$/i, '');
}

// ── Utilidades ────────────────────────────────────────────────────
function parseCard(path) {
  const withoutPrefix = path.slice('cartas/'.length);
  const parts = withoutPrefix.split('/');
  const baseName = parts[parts.length - 1].replace('.png', '');
  const m = baseName.match(/^(.+?)(?:\s+\((\d+)\))?$/);
  const nombre     = m ? m[1].trim() : baseName;
  const copies     = m && m[2] ? parseInt(m[2]) : 1;
  const tipo       = parts[0];
  const subtipo    = parts.length >= 3 ? parts[1] : null;
  const subsubtipo = parts.length >= 4 ? parts[2] : null;
  return { id: withoutPrefix.replace('.png', ''), path, nombre, copies, tipo, subtipo, subsubtipo };
}

function cardUrl(path) { return path.split('/').map(encodeURIComponent).join('/'); }

// URL de la versión WebP optimizada (galería). Fallback al PNG original si no existe.
function webUrl(path) {
  const webPath = 'web/' + path.slice('cartas/'.length).replace(/\.png$/i, '.webp');
  return webPath.split('/').map(encodeURIComponent).join('/');
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function translateAuthError(code) {
  return ({
    'auth/invalid-email':          'Email inválido.',
    'auth/invalid-credential':     'Email o contraseña incorrectos.',
    'auth/user-not-found':         'No existe ninguna cuenta con ese email.',
    'auth/wrong-password':         'Contraseña incorrecta.',
    'auth/email-already-in-use':   'Este email ya está registrado.',
    'auth/weak-password':          'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests':      'Demasiados intentos. Espera un momento.',
    'auth/network-request-failed': 'Sin conexión. Revisa tu red.',
  })[code] || 'Error de autenticación. Inténtalo de nuevo.';
}

// ── Reglas de cada sección ────────────────────────────────────────
const RULES = {
  party: {
    label: 'La Party',    target: 10,
    hint: '1 héroe + 9 esbirros · sin repeticiones',
  },
  mazo: {
    label: 'El Deck',     target: 40,
    hint: '40 cartas · máx. 2 copias · sin personajes ni fichas',
  },
  banquillo: {
    label: 'El Banquillo',target: 10,
    hint: '10 cartas · esbirros máx. 1 copia · sin héroes ni fichas',
  },
  fichas: {
    label: 'Fichas',      target: null,  // sin límite de total
    hint: 'Solo fichas · 1 copia de cada una',
  },
};

function isHero(card)    { return card.tipo === 'personajes' && card.subtipo === 'Heroes'; }
function isEsbirro(card) { return card.tipo === 'personajes' && card.subtipo === 'Esbirros'; }
function isFicha(card)   { return card.tipo === 'fichas'; }

function canAdd(section, card, entries) {
  const total  = entries.reduce((s, e) => s + e.count, 0);
  const exists = entries.find(e => e.card.id === card.id);

  if (section === 'party') {
    if (!isHero(card) && !isEsbirro(card))
      return 'La Party solo admite Héroes y Esbirros.';
    if (exists)
      return 'No puede haber cartas repetidas en la Party.';
    if (total >= 10)
      return 'La Party ya tiene 10 cartas.';
    if (isHero(card) && entries.some(e => isHero(e.card)))
      return 'La Party solo puede tener 1 Héroe.';
    if (isEsbirro(card) && entries.filter(e => isEsbirro(e.card)).reduce((s,e)=>s+e.count,0) >= 9)
      return 'La Party ya tiene 9 Esbirros.';
  }

  if (section === 'mazo') {
    if (isHero(card))
      return 'Los Héroes solo van en La Party.';
    if (isEsbirro(card))
      return 'Los Esbirros solo van en La Party o El Banquillo.';
    if (isFicha(card))
      return 'Las Fichas solo van en el apartado de Fichas.';
    if (total >= 40)
      return 'El Deck ya tiene 40 cartas.';
    if (exists && exists.count >= 2)
      return 'Máximo 2 copias por carta en el Deck.';
  }

  if (section === 'banquillo') {
    if (isHero(card))
      return 'Los Héroes solo van en La Party.';
    if (isFicha(card))
      return 'Las Fichas solo van en el apartado de Fichas.';
    if (total >= 10)
      return 'El Banquillo ya tiene 10 cartas.';
    const max = isEsbirro(card) ? 1 : 2;
    if (exists && exists.count >= max)
      return isEsbirro(card)
        ? 'Los Esbirros solo pueden tener 1 copia en el Banquillo.'
        : 'Máximo 2 copias por carta en el Banquillo.';
  }

  if (section === 'fichas') {
    if (!isFicha(card))
      return 'Este apartado solo admite Fichas.';
    if (exists)
      return 'Solo puede haber 1 copia de cada Ficha.';
  }

  return null; // ok
}

// ── App ───────────────────────────────────────────────────────────
createApp({
  setup() {

    // ── Auth ───────────────────────────────────
    const currentUser         = ref(null);
    const authLoading         = ref(true);
    const authMode            = ref('login');
    const authEmail           = ref('');
    const authPassword        = ref('');
    const authPasswordConfirm = ref('');
    const authError           = ref('');
    const authSubmitting      = ref(false);

    const ALLOWED = (window.ALLOWED_EMAILS || []).map(e => e.toLowerCase());
    function isAllowed(email) { return ALLOWED.includes(email.trim().toLowerCase()); }

    async function login() {
      authSubmitting.value = true; authError.value = '';
      try {
        if (!isAllowed(authEmail.value)) { authError.value = 'Este email no está autorizado para acceder.'; return; }
        await auth.signInWithEmailAndPassword(authEmail.value.trim(), authPassword.value);
      } catch (e) { authError.value = translateAuthError(e.code); }
      finally { authSubmitting.value = false; }
    }

    async function register() {
      if (!isAllowed(authEmail.value)) { authError.value = 'Este email no está autorizado. Pide al admin que te añada.'; return; }
      if (authPassword.value !== authPasswordConfirm.value) { authError.value = 'Las contraseñas no coinciden.'; return; }
      authSubmitting.value = true; authError.value = '';
      try { await auth.createUserWithEmailAndPassword(authEmail.value.trim(), authPassword.value); }
      catch (e) { authError.value = translateAuthError(e.code); }
      finally { authSubmitting.value = false; }
    }

    function logout() { auth.signOut(); }

    // ── Cards ──────────────────────────────────
    const rawCards       = ref([]);   // de cards.json (paths)
    const seedMeta       = ref({});   // de cards-meta.json (semilla OCR)
    const metaOverrides  = ref({});   // de Firestore /cards-meta (ediciones manuales)
    const loading        = ref(true);
    const loadError      = ref(false);

    async function loadCards() {
      try {
        // Cache-bust: el CDN de GitHub Pages cachea hasta 10 min. Query único
        // garantiza que el catálogo se actualice nada más terminar el deploy.
        const res = await fetch('cards.json?v=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error();
        const paths = await res.json();
        rawCards.value = paths.map(parseCard);
      } catch { loadError.value = true; }
      finally { loading.value = false; }
    }

    // Semilla de metadatos (OCR) — si el fichero no existe aún, simplemente
    // arrancamos con todo vacío. No es fatal.
    async function loadCardsMeta() {
      try {
        const res = await fetch('cards-meta.json?v=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const byId = {};
        for (const [p, meta] of Object.entries(json)) byId[pathToCardId(p)] = meta;
        seedMeta.value = byId;
      } catch { /* ignoramos; la web funciona igual sin semilla */ }
    }

    // Lista efectiva: cartas con efecto/ataque/vida fusionados.
    // Orden de prioridad: Firestore override > semilla JSON > vacío.
    // Incluye además las cartas "custom" creadas en Firestore que no están
    // en cards.json (no tienen PNG en el repo).
    const allCards = computed(() => {
      const seenIds = new Set();
      const list = rawCards.value.map(card => {
        seenIds.add(card.id);
        const seed = seedMeta.value[card.id] || {};
        const ov   = metaOverrides.value[card.id] || {};
        const pick = (k) => ov[k] !== undefined && ov[k] !== null
                             ? ov[k]
                             : (seed[k] !== undefined ? seed[k] : null);
        return {
          ...card,
          // Permitir que el override cambie nombre/tipo/subtipo (sobrescribir).
          nombre:     ov.nombre     || card.nombre,
          tipo:       ov.tipo       || card.tipo,
          subtipo:    ov.subtipo    || card.subtipo,
          subsubtipo: ov.subsubtipo || card.subsubtipo,
          efecto: pick('efecto') || '',
          ataque: pick('ataque'),
          vida:   pick('vida'),
          renderedUrl: ov.renderedUrl || null,
          artUrl:      ov.artUrl      || null,
          frameKey:    ov.frameKey    || null,
          metaEdited: Boolean(metaOverrides.value[card.id]),
        };
      });
      // Cartas creadas desde la web (no existen en cards.json).
      for (const [id, ov] of Object.entries(metaOverrides.value)) {
        if (seenIds.has(id)) continue;
        if (!ov.renderedUrl) continue;   // no tiene imagen aún, ignorar
        const fakePath = 'cartas/' + id + '.png';
        list.push({
          id,
          path:        fakePath,
          nombre:      ov.nombre || id.split('/').pop(),
          copies:      1,
          tipo:        ov.tipo       || null,
          subtipo:     ov.subtipo    || null,
          subsubtipo:  ov.subsubtipo || null,
          efecto:      ov.efecto || '',
          ataque:      ov.ataque,
          vida:        ov.vida,
          renderedUrl: ov.renderedUrl,
          artUrl:      ov.artUrl || null,
          frameKey:    ov.frameKey || null,
          metaEdited:  true,
          custom:      true,
        });
      }
      return list.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    });

    // ── Gallery filters ────────────────────────
    const search           = ref('');
    const filterTipo       = ref('todos');
    const filterSubtipo    = ref('todos');
    const filterSubsubtipo = ref('todos');

    const tipoOptions = computed(() => {
      const tipos = [...new Set(allCards.value.map(c => c.tipo))].sort();
      return [{ value: 'todos', label: 'Todos' }, ...tipos.map(t => ({ value: t, label: cap(t) }))];
    });
    const subtipoOptions = computed(() => {
      if (filterTipo.value === 'todos') return [];
      const seen = new Set(allCards.value.filter(c => c.tipo === filterTipo.value && c.subtipo).map(c => c.subtipo));
      if (!seen.size) return [];
      return [{ value: 'todos', label: 'Todos' }, ...[...seen].sort().map(s => ({ value: s, label: cap(s) }))];
    });
    const subsubtipoOptions = computed(() => {
      if (filterSubtipo.value === 'todos') return [];
      const seen = new Set(allCards.value
        .filter(c => c.tipo === filterTipo.value && c.subtipo === filterSubtipo.value && c.subsubtipo)
        .map(c => c.subsubtipo));
      if (!seen.size) return [];
      return [{ value: 'todos', label: 'Todos' }, ...[...seen].sort().map(s => ({ value: s, label: cap(s) }))];
    });
    const filteredCards = computed(() => {
      let cards = allCards.value;
      if (filterTipo.value !== 'todos')       cards = cards.filter(c => c.tipo       === filterTipo.value);
      if (filterSubtipo.value !== 'todos')    cards = cards.filter(c => c.subtipo    === filterSubtipo.value);
      if (filterSubsubtipo.value !== 'todos') cards = cards.filter(c => c.subsubtipo === filterSubsubtipo.value);
      if (search.value.trim()) {
        const q = search.value.toLowerCase();
        cards = cards.filter(c =>
          c.nombre.toLowerCase().includes(q) ||
          (c.efecto || '').toLowerCase().includes(q)
        );
      }
      return cards;
    });
    function setTipo(t)  { filterTipo.value = t;  filterSubtipo.value = 'todos'; filterSubsubtipo.value = 'todos'; }
    function setSubtipo(s){ filterSubtipo.value = s; filterSubsubtipo.value = 'todos'; }

    // ── UI state ───────────────────────────────
    const view         = ref('gallery');
    const showDeck     = ref(false);
    const selectedCard = ref(null);

    // ── Scroll infinito ────────────────────────
    const PAGE = 60;
    const visibleCount = ref(PAGE);
    const visibleCards = computed(() => filteredCards.value.slice(0, visibleCount.value));
    const hasMore      = computed(() => visibleCount.value < filteredCards.value.length);

    function loadMore() { visibleCount.value += PAGE; }

    // ── Deck builder ───────────────────────────
    const deckName      = ref('Nuevo Mazo');
    const activeSection = ref('mazo');    // 'party' | 'mazo' | 'banquillo' | 'fichas'
    const partyCards    = ref([]);
    const mainCards     = ref([]);
    const benchCards    = ref([]);
    const fichaCards    = ref([]);
    const editingDeckId = ref(null);
    const saving        = ref(false);
    const validationMsg = ref('');
    let validationTimer = null;

    function showValidation(msg) {
      validationMsg.value = msg;
      clearTimeout(validationTimer);
      validationTimer = setTimeout(() => validationMsg.value = '', 3000);
    }

    function sectionRef(section) {
      if (section === 'party')    return partyCards;
      if (section === 'mazo')     return mainCards;
      if (section === 'banquillo')return benchCards;
      return fichaCards;
    }

    const partyTotal    = computed(() => partyCards.value.reduce((s, e) => s + e.count, 0));
    const mazoTotal     = computed(() => mainCards.value.reduce((s, e) => s + e.count, 0));
    const banquilloTotal= computed(() => benchCards.value.reduce((s, e) => s + e.count, 0));
    const fichaTotal    = computed(() => fichaCards.value.reduce((s, e) => s + e.count, 0));
    const deckTotal     = computed(() => partyTotal.value + mazoTotal.value + banquilloTotal.value + fichaTotal.value);

    // Devuelve el array de cartas de la sección activa (para la plantilla)
    const activeCards = computed(() => sectionRef(activeSection.value).value);

    function sectionTotalByKey(key) {
      if (key === 'party')    return partyTotal.value;
      if (key === 'mazo')     return mazoTotal.value;
      if (key === 'banquillo')return banquilloTotal.value;
      return fichaTotal.value;
    }

    function addToDeck(card) {
      const target  = sectionRef(activeSection.value);
      const error   = canAdd(activeSection.value, card, target.value);
      if (error) { showValidation(error); return; }
      const entry = target.value.find(e => e.card.id === card.id);
      if (entry) entry.count++;
      else target.value.push({ card, count: 1 });
      showDeck.value = true;
    }

    function decrementCard(card) {
      const target = sectionRef(activeSection.value);
      const idx = target.value.findIndex(e => e.card.id === card.id);
      if (idx === -1) return;
      if (target.value[idx].count <= 1) target.value.splice(idx, 1);
      else target.value[idx].count--;
    }

    function cardInActiveSection(card) {
      return sectionRef(activeSection.value).value.find(e => e.card.id === card.id)?.count || 0;
    }

    // small colored dots on gallery cards showing which sections they're in
    function cardSections(card) {
      const sections = [];
      if (partyCards.value.find(e => e.card.id === card.id))  sections.push('party');
      if (mainCards.value.find(e => e.card.id === card.id))   sections.push('mazo');
      if (benchCards.value.find(e => e.card.id === card.id))  sections.push('banquillo');
      if (fichaCards.value.find(e => e.card.id === card.id))  sections.push('fichas');
      return sections;
    }

    function clearDeck() { sectionRef(activeSection.value).value = []; }
    function newDeck()   { partyCards.value = []; mainCards.value = []; benchCards.value = []; fichaCards.value = []; deckName.value = 'Nuevo Mazo'; editingDeckId.value = null; }

    function loadDeck(deck) {
      deckName.value = deck.name;
      editingDeckId.value = deck.uid === currentUser.value?.uid ? deck.id : null;
      const resolve = entries => (entries || []).map(e => {
        const card = findCardByAnyId(e.cardId);
        return card ? { card, count: e.count } : null;
      }).filter(Boolean);
      if (deck.party !== undefined) {
        partyCards.value  = resolve(deck.party);
        mainCards.value   = resolve(deck.mazo);
        benchCards.value  = resolve(deck.banquillo);
        fichaCards.value  = resolve(deck.fichas || []);
      } else {
        // Formato antiguo: todo al deck principal
        partyCards.value = []; mainCards.value = resolve(deck.cards);
        benchCards.value = []; fichaCards.value = [];
      }
      view.value = 'gallery'; showDeck.value = true;
    }

    // ── Firestore: metadatos de cartas ─────────
    let unsubscribeMeta = null;
    function subscribeToCardsMeta() {
      if (unsubscribeMeta) unsubscribeMeta();
      unsubscribeMeta = db.collection('cards-meta').onSnapshot(snap => {
        const map = {};
        snap.docs.forEach(doc => {
          const d = doc.data();
          const cardId = d.cardId || cardIdFromDoc(doc.id);
          map[cardId] = d;
        });
        metaOverrides.value = map;
      }, err => console.error('Firestore cards-meta error:', err));
    }
    function unsubscribeFromCardsMeta() {
      if (unsubscribeMeta) { unsubscribeMeta(); unsubscribeMeta = null; }
      metaOverrides.value = {};
    }

    // ── Firestore: mazos ───────────────────────
    const savedDecks = ref([]);
    const deckFilter = ref('all');
    let   unsubscribeDecks = null;

    const myDecks            = computed(() => savedDecks.value.filter(d => d.uid === currentUser.value?.uid));
    const filteredSavedDecks = computed(() => deckFilter.value === 'mine' ? myDecks.value : savedDecks.value);

    function subscribeToDecks() {
      if (unsubscribeDecks) unsubscribeDecks();
      unsubscribeDecks = db.collection('decks').orderBy('savedAt', 'desc').limit(200)
        .onSnapshot(snap => { savedDecks.value = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })); },
          err => console.error('Firestore error:', err));
    }
    function unsubscribeFromDecks() {
      if (unsubscribeDecks) { unsubscribeDecks(); unsubscribeDecks = null; }
      savedDecks.value = [];
    }

    const serialize = entries => entries.map(e => ({
      cardId: e.card.id, nombre: e.card.nombre, tipo: e.card.tipo,
      subtipo: e.card.subtipo || null, count: e.count,
    }));

    async function saveDeck() {
      if (!currentUser.value) return;
      saving.value = true;
      const data = {
        name: deckName.value || 'Mazo sin nombre',
        uid: currentUser.value.uid,
        ownerEmail: currentUser.value.email,
        party:     serialize(partyCards.value),
        mazo:      serialize(mainCards.value),
        banquillo: serialize(benchCards.value),
        fichas:    serialize(fichaCards.value),
        savedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      try {
        if (editingDeckId.value) await db.collection('decks').doc(editingDeckId.value).update(data);
        else { const ref = await db.collection('decks').add(data); editingDeckId.value = ref.id; }
      } catch (e) { console.error('Error guardando mazo:', e); }
      finally { saving.value = false; }
    }

    async function deleteDeck(id) {
      try { await db.collection('decks').doc(id).delete(); }
      catch (e) { console.error('Error eliminando mazo:', e); }
      if (editingDeckId.value === id) newDeck();
    }

    function deckCardCount(deck) {
      if (deck.party !== undefined) {
        return [...(deck.party||[]), ...(deck.mazo||[]), ...(deck.banquillo||[]), ...(deck.fichas||[])].reduce((s,e)=>s+e.count,0);
      }
      return (deck.cards||[]).reduce((s,e)=>s+e.count,0);
    }

    function sectionCount(deck, key) {
      return (deck[key] || []).reduce((s,e)=>s+e.count,0);
    }

    // ── Zoom preview ───────────────────────────
    const hoveredCard = ref(null);
    const hoverX = ref(0), hoverY = ref(0);
    // Normaliza un cardId quitando el sufijo de versión "(N)" al final:
    // "magia/arcana/Anular (6)" -> "magia/arcana/Anular"
    function baseId(id) { return (id || '').replace(/\s*\(\d+\)$/, ''); }

    // Busca la carta actual por id exacto; si la versión exacta ya no existe,
    // devuelve la versión más reciente (mayor número) con la misma ruta base.
    function findCardByAnyId(cardId) {
      if (!cardId) return null;
      const exact = allCards.value.find(c => c.id === cardId);
      if (exact) return exact;
      const base = baseId(cardId);
      const candidates = allCards.value.filter(c => baseId(c.id) === base);
      if (!candidates.length) return null;
      return candidates.slice().sort((a, b) => b.copies - a.copies)[0];
    }

    function startHover(card, e) { hoveredCard.value = card; hoverX.value = e.clientX; hoverY.value = e.clientY; }
    function startHoverById(cardId, e) {
      const card = findCardByAnyId(cardId);
      if (card) startHover(card, e);
    }
    function moveHover(e)        { hoverX.value = e.clientX; hoverY.value = e.clientY; }
    function endHover()          { hoveredCard.value = null; }
    const ZOOM_W = 260, ZOOM_H = 364, PAD = 12;
    const zoomStyle = computed(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = hoverX.value + 20, y = hoverY.value - ZOOM_H / 2;
      if (x + ZOOM_W > vw - PAD) x = hoverX.value - ZOOM_W - 16;
      if (y < PAD) y = PAD;
      if (y + ZOOM_H > vh - PAD) y = vh - ZOOM_H - PAD;
      return { left: x + 'px', top: y + 'px' };
    });

    // ── TTS export ─────────────────────────────
    const PAGES_BASE = 'https://fikiy-stimorol.github.io/EthrA_CG/';

    function buildTTSPile(entries, pileName, posX, idxOffset) {
      if (!entries.length) return null;
      const BACK = PAGES_BASE + 'dorso.png';
      const deckIds = [], customDeck = {}, containedObjects = [];
      entries.forEach((entry, i) => {
        const idx = idxOffset + i + 1, cardId = idx * 100;
        // Si la carta tiene renderedUrl (custom/editada), Storage es URL absoluta
        // y se sirve directa. Si no, usamos el WebP del repo en Pages.
        const faceUrl = entry.renderedUrl || (PAGES_BASE + webUrl(entry.path));
        customDeck[String(idx)] = { FaceURL: faceUrl, BackURL: BACK, NumWidth:1, NumHeight:1, BackIsHidden:true, UniqueBack:false, Type:0 };
        for (let c = 0; c < entry.count; c++) {
          deckIds.push(cardId);
          containedObjects.push({
            Name: 'Card',
            Transform: { posX:0, posY:0, posZ:0, rotX:0, rotY:180, rotZ:180, scaleX:1, scaleY:1, scaleZ:1 },
            Nickname: entry.nombre, Description: entry.tipo || '',
            CardID: cardId, CustomDeck: { [String(idx)]: customDeck[String(idx)] },
            XmlUI:'', LuaScript:'', LuaScriptState:'',
            GUID: Math.random().toString(16).slice(2, 8),
          });
        }
      });
      const t = { posX, posY:1.5, posZ:0, rotX:0, rotY:0, rotZ:180, scaleX:1, scaleY:1, scaleZ:1 };
      if (containedObjects.length === 1)
        return { ...containedObjects[0], Transform: { ...t, rotY:180 } };
      return {
        Name:'Deck', Nickname: pileName, Description:'', Transform: t,
        ColorDiffuse:{r:0.713,g:0.713,b:0.713},
        Locked:false,Grid:true,Snap:true,IgnoreFoW:false,Autoraise:true,
        Sticky:true,Tooltip:true,GridProjection:false,HideWhenFaceDown:true,
        Hands:false,SidewaysCard:false,
        DeckIDs:deckIds, CustomDeck:customDeck,
        XmlUI:'',LuaScript:'',LuaScriptState:'',
        ContainedObjects:containedObjects,
        GUID: Math.random().toString(16).slice(2, 8),
      };
    }

    function buildTTSMulti(piles, saveName) {
      const objectStates = [];
      let offset = 0;
      for (const pile of piles) {
        if (pile.entries.length) {
          const obj = buildTTSPile(pile.entries, pile.name, pile.posX, offset);
          if (obj) objectStates.push(obj);
          offset += pile.entries.length;
        }
      }
      return { SaveName: saveName, GameMode:'', Gravity:0.5, PlayArea:0.5,
        Table:'',Sky:'',Note:'',Rules:'',XmlUI:'',LuaScript:'',LuaScriptState:'',
        ObjectStates: objectStates };
    }

    function toTTSEntries(cards) {
      return cards.map(e => {
        if (e.card) return {
          path: e.card.path, nombre: e.card.nombre, tipo: e.card.tipo,
          renderedUrl: e.card.renderedUrl || null, count: e.count,
        };
        const current = findCardByAnyId(e.cardId);
        return {
          path:   current ? current.path   : 'cartas/' + e.cardId + '.png',
          nombre: current ? current.nombre : e.nombre,
          tipo:   current ? current.tipo   : e.tipo,
          renderedUrl: current ? current.renderedUrl || null : null,
          count:  e.count,
        };
      });
    }

    function makePiles(deck) {
      if (deck.party !== undefined) {
        return [
          { entries: toTTSEntries(deck.party    || []), name: 'La Party',     posX: -9 },
          { entries: toTTSEntries(deck.mazo     || []), name: 'El Deck',      posX: -3 },
          { entries: toTTSEntries(deck.banquillo|| []), name: 'El Banquillo', posX:  3 },
          { entries: toTTSEntries(deck.fichas   || []), name: 'Fichas',       posX:  9 },
        ];
      }
      return [{ entries: toTTSEntries(deck.cards || []), name: deck.name, posX: 0 }];
    }

    function exportCurrentToTTS() {
      if (!deckTotal.value) return;
      const piles = makePiles({ party: serialize(partyCards.value), mazo: serialize(mainCards.value), banquillo: serialize(benchCards.value), fichas: serialize(fichaCards.value) });
      downloadFile(JSON.stringify(buildTTSMulti(piles, deckName.value), null, 2), deckName.value + '.json', 'application/json');
    }

    function exportSavedToTTS(deck) {
      downloadFile(JSON.stringify(buildTTSMulti(makePiles(deck), deck.name), null, 2), deck.name + '.json', 'application/json');
    }

    // ── JSON export/import backup ──────────────
    const importMsg = ref('');

    function downloadFile(content, filename, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }

    function exportDecksJson() {
      if (!myDecks.value.length) return;
      downloadFile(JSON.stringify(myDecks.value, null, 2), 'ethra-mazos.json', 'application/json');
    }

    async function importDecksJson(event) {
      const file = event.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (!Array.isArray(imported)) throw new Error();
          const existingIds = new Set(savedDecks.value.map(d => d.id));
          let added = 0;
          for (const deck of imported) {
            if (existingIds.has(deck.id)) continue;
            await db.collection('decks').add({
              name: deck.name, uid: currentUser.value.uid, ownerEmail: currentUser.value.email,
              party: deck.party || [], mazo: deck.mazo || (deck.cards || []), banquillo: deck.banquillo || [],
              savedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            added++;
          }
          importMsg.value = added ? `${added} mazo(s) importado(s) ✓` : 'Ya tenías todos esos mazos';
        } catch { importMsg.value = 'Archivo no válido'; }
        setTimeout(() => importMsg.value = '', 3000);
        event.target.value = '';
      };
      reader.readAsText(file);
    }

    // ── Editor de carta (modal) ────────────────
    const editorOpen     = ref(false);
    const editorMode     = ref('edit');         // 'edit' | 'create'
    const previewCanvas  = ref(null);
    const editingMeta    = reactive({
      nombre: '', tipo: '', subtipo: '', subsubtipo: '',
      frameKey: 'Magia',
      efecto: '', ataque: '', vida: '',
      artUrl: '',          // URL del arte previo en Storage
      artFile: null,       // File nuevo (si el usuario sube uno)
      artLocalUrl: '',     // ObjectURL para el preview en vivo
      artUrlInput: '',     // URL que el usuario teclea para cargar
    });
    const savingMeta     = ref(false);
    const saveMetaStatus = ref('');
    const saveMetaError  = ref('');
    const saveProgress   = ref('Guardando...');
    const loadingArt     = ref(false);
    const artUrlError    = ref('');

    // Lista para el dropdown del marco (sin reactividad, solo para la plantilla)
    const FRAMES_LIST = FRAMES;

    // Datalists con valores existentes para tipo/subtipo
    const knownTipos = computed(() => [...new Set(allCards.value.map(c => c.tipo).filter(Boolean))].sort());
    const knownSubtipos = computed(() => [...new Set(allCards.value.map(c => c.subtipo).filter(Boolean))].sort());

    const frameHasStats = computed(() => (FRAMES[editingMeta.frameKey] || {}).hasStats);

    // Deriva un frameKey razonable a partir del tipo/subtipo de una carta existente.
    function defaultFrameFor(card) {
      if (card.tipo === 'magia')      return 'Magia';
      if (card.tipo === 'maniobras')  return 'Maniobra';
      if (card.tipo === 'objetos' && card.subtipo === 'desechables') return 'Objeto-desechable';
      if (card.tipo === 'objetos')    return 'Objeto';
      if (card.tipo === 'personajes' && card.subtipo === 'Heroes') return 'Heroe';
      if (card.tipo === 'personajes') return 'Esbirro';
      if (card.tipo === 'fichas')     return 'Esbirro';   // se puede cambiar a Objeto
      return 'Magia';
    }

    function openModal(card) {
      selectedCard.value = card;
      editorMode.value = 'edit';
      const ov = metaOverrides.value[card.id] || {};
      editingMeta.nombre     = ov.nombre     || card.nombre;
      editingMeta.tipo       = ov.tipo       || card.tipo       || '';
      editingMeta.subtipo    = ov.subtipo    || card.subtipo    || '';
      editingMeta.subsubtipo = ov.subsubtipo || card.subsubtipo || '';
      editingMeta.frameKey   = ov.frameKey   || defaultFrameFor(card);
      editingMeta.efecto     = card.efecto || '';
      editingMeta.ataque     = card.ataque != null ? String(card.ataque) : '';
      editingMeta.vida       = card.vida   != null ? String(card.vida)   : '';
      editingMeta.artUrl     = ov.artUrl || '';
      editingMeta.artFile    = null;
      editingMeta.artLocalUrl = '';
      editingMeta.artUrlInput = '';
      artUrlError.value = '';
      saveMetaStatus.value = '';
      saveMetaError.value  = '';
      editorOpen.value = true;
      nextTick(refreshPreview);
    }

    function openCreator() {
      selectedCard.value = null;
      editorMode.value = 'create';
      editingMeta.nombre     = '';
      editingMeta.tipo       = '';
      editingMeta.subtipo    = '';
      editingMeta.subsubtipo = '';
      editingMeta.frameKey   = 'Magia';
      editingMeta.efecto     = '';
      editingMeta.ataque     = '';
      editingMeta.vida       = '';
      editingMeta.artUrl     = '';
      editingMeta.artFile    = null;
      editingMeta.artLocalUrl = '';
      editingMeta.artUrlInput = '';
      artUrlError.value = '';
      saveMetaStatus.value = '';
      saveMetaError.value  = '';
      editorOpen.value = true;
      nextTick(refreshPreview);
    }

    function closeEditor() {
      editorOpen.value = false;
      if (editingMeta.artLocalUrl) {
        URL.revokeObjectURL(editingMeta.artLocalUrl);
        editingMeta.artLocalUrl = '';
      }
    }

    function onArtUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      if (editingMeta.artLocalUrl) URL.revokeObjectURL(editingMeta.artLocalUrl);
      editingMeta.artFile = file;
      editingMeta.artLocalUrl = URL.createObjectURL(file);
      artUrlError.value = '';
      refreshPreview();
    }

    // Carga una imagen desde una URL pública. Se descarga vía fetch para
    // evitar problemas de CORS al renderizar en canvas — la imagen pasa a
    // tratarse como un File local. Si el servidor remoto no permite CORS,
    // se notifica el error claramente.
    async function loadArtFromUrl() {
      const url = editingMeta.artUrlInput.trim();
      if (!url) return;
      loadingArt.value = true;
      artUrlError.value = '';
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        if (!blob.type.startsWith('image/')) throw new Error('La URL no apunta a una imagen.');
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const file = new File([blob], 'art.' + ext, { type: blob.type });
        if (editingMeta.artLocalUrl) URL.revokeObjectURL(editingMeta.artLocalUrl);
        editingMeta.artFile = file;
        editingMeta.artLocalUrl = URL.createObjectURL(file);
        editingMeta.artUrlInput = '';
        refreshPreview();
      } catch (e) {
        console.error('loadArtFromUrl', e);
        artUrlError.value = 'No se pudo cargar la imagen (CORS bloqueado o URL inválida). '
                          + 'Prueba con otra URL o sube el archivo directamente.';
      } finally {
        loadingArt.value = false;
      }
    }

    // Pinta el preview con los valores actuales del editor.
    let _previewToken = 0;
    async function refreshPreview() {
      if (!previewCanvas.value) return;
      const token = ++_previewToken;
      const artUrl = editingMeta.artLocalUrl
                  || (editingMeta.artUrl
                       ? editingMeta.artUrl
                       : (selectedCard.value && editorMode.value === 'edit'
                           ? cardUrl(selectedCard.value.path) : ''));
      try {
        await renderCardCanvas({
          canvas:   previewCanvas.value,
          frameKey: editingMeta.frameKey,
          artUrl,
          nombre:   editingMeta.nombre,
          efecto:   editingMeta.efecto,
          tipo:     editingMeta.tipo,
          subtipo:  editingMeta.subtipo,
          ataque:   editingMeta.ataque,
          vida:     editingMeta.vida,
        });
      } catch (e) {
        if (token === _previewToken) console.warn('preview error', e);
      }
    }

    // Re-render del preview cuando cambia cualquier campo relevante.
    watch(() => [
      editingMeta.nombre, editingMeta.tipo, editingMeta.subtipo,
      editingMeta.frameKey, editingMeta.efecto, editingMeta.ataque,
      editingMeta.vida, editingMeta.artLocalUrl, editingMeta.artUrl,
    ], () => { if (editorOpen.value) refreshPreview(); });

    // Al recompute allCards (p. ej. tras snapshot Firestore), refresca selectedCard.
    watch(allCards, (cards) => {
      if (!selectedCard.value) return;
      const updated = cards.find(c => c.id === selectedCard.value.id);
      if (updated && updated !== selectedCard.value) selectedCard.value = updated;
    });

    // ¿Hay cambios respecto a lo actualmente cargado?
    const metaDirty = computed(() => {
      if (editorMode.value === 'create') return true;
      const c = selectedCard.value;
      if (!c) return false;
      const ov = metaOverrides.value[c.id] || {};
      const normNum = s => (s === '' || s == null) ? null : (isNaN(Number(s)) ? s : Number(s));
      return editingMeta.efecto     !== (c.efecto || '')
          || normNum(editingMeta.ataque) !== (c.ataque ?? null)
          || normNum(editingMeta.vida)   !== (c.vida   ?? null)
          || editingMeta.nombre     !== (ov.nombre     || c.nombre)
          || editingMeta.tipo       !== (ov.tipo       || c.tipo       || '')
          || editingMeta.subtipo    !== (ov.subtipo    || c.subtipo    || '')
          || editingMeta.subsubtipo !== (ov.subsubtipo || c.subsubtipo || '')
          || editingMeta.frameKey   !== (ov.frameKey   || defaultFrameFor(c))
          || editingMeta.artFile != null;
    });

    function buildCardId(meta) {
      const parts = [meta.tipo, meta.subtipo, meta.subsubtipo, meta.nombre]
        .map(s => (s || '').trim())
        .filter(Boolean);
      return parts.join('/');
    }

    async function uploadBlob(blob, path) {
      const ref = storage.ref(path);
      await ref.put(blob);
      return ref.getDownloadURL();
    }

    async function deleteCard() {
      if (!selectedCard.value || !currentUser.value) return;
      const card = selectedCard.value;
      const isCustom = !!card.custom;
      const msg = isCustom
        ? `¿Eliminar la carta "${card.nombre}" definitivamente? Esto borra la imagen y los datos.`
        : `¿Restablecer la carta "${card.nombre}" a su versión original? Se perderán los cambios y la imagen renderizada.`;
      if (!confirm(msg)) return;

      savingMeta.value = true;
      saveProgress.value = isCustom ? 'Eliminando...' : 'Restableciendo...';
      saveMetaError.value  = '';
      try {
        const ov = metaOverrides.value[card.id] || {};
        // 1) Borrar archivos en Storage si existen.
        const tryDelete = async (url) => {
          if (!url) return;
          try { await storage.refFromURL(url).delete(); }
          catch (e) { if (e.code !== 'storage/object-not-found') console.warn('storage delete', e); }
        };
        await tryDelete(ov.renderedUrl);
        await tryDelete(ov.artUrl);

        // 2) Borrar el doc de Firestore.
        await db.collection('cards-meta').doc(metaDocId(card.id)).delete();

        saveMetaStatus.value = 'saved';
        closeEditor();
      } catch (e) {
        console.error('delete error', e);
        saveMetaError.value = 'No se pudo eliminar: ' + (e.message || e);
      } finally {
        savingMeta.value = false;
        saveProgress.value = 'Guardando...';
      }
    }

    async function saveCardMeta() {
      if (!currentUser.value) return;
      const nombre = editingMeta.nombre.trim();
      const tipo   = editingMeta.tipo.trim();
      if (!nombre) { saveMetaError.value = 'El nombre es obligatorio.'; return; }
      if (!tipo)   { saveMetaError.value = 'El tipo es obligatorio.';   return; }
      if (frameHasStats.value) {
        // Permitimos vacío o cualquier string corto (p.ej. "+1"). Si lo dejan
        // vacío se interpreta como "sin valor".
      }

      savingMeta.value = true;
      saveMetaStatus.value = '';
      saveMetaError.value  = '';

      try {
        const isCreate = editorMode.value === 'create';
        const baseCard = selectedCard.value;
        // Para edición mantenemos el cardId original (sobrescribimos sobre él).
        // Para creación, lo construimos a partir de tipo/subtipo/nombre.
        const cardId = isCreate
          ? buildCardId({ tipo, subtipo: editingMeta.subtipo.trim(),
                          subsubtipo: editingMeta.subsubtipo.trim(), nombre })
          : baseCard.id;

        if (!cardId) throw new Error('No se pudo construir el id de la carta.');
        if (isCreate) {
          // Evitar pisar una carta existente sin querer.
          if (rawCards.value.find(c => c.id === cardId) || metaOverrides.value[cardId]) {
            throw new Error('Ya existe una carta con ese tipo/subtipo/nombre.');
          }
        }

        // 1) Subir arte si el usuario lo cambió.
        let artUrl = editingMeta.artUrl;
        if (editingMeta.artFile) {
          saveProgress.value = 'Subiendo arte...';
          const ext = (editingMeta.artFile.name.split('.').pop() || 'png').toLowerCase();
          artUrl = await uploadBlob(editingMeta.artFile, `arts/${metaDocId(cardId)}.${ext}`);
        }

        // 2) Renderizar la carta a un canvas offscreen y subir el PNG resultante.
        saveProgress.value = 'Renderizando...';
        const off = document.createElement('canvas');
        await renderCardCanvas({
          canvas:   off,
          frameKey: editingMeta.frameKey,
          artUrl:   artUrl || (baseCard ? cardUrl(baseCard.path) : ''),
          nombre,
          efecto:   editingMeta.efecto,
          tipo,
          subtipo:  editingMeta.subtipo.trim(),
          ataque:   editingMeta.ataque.trim(),
          vida:     editingMeta.vida.trim(),
        });
        saveProgress.value = 'Subiendo carta...';
        const renderedBlob = await canvasToBlob(off);
        const renderedUrl  = await uploadBlob(renderedBlob, `cards/${metaDocId(cardId)}.png`);

        // 3) Persistir meta en Firestore.
        saveProgress.value = 'Guardando...';
        const atkStr = editingMeta.ataque.trim();
        const vidStr = editingMeta.vida.trim();
        const numOrStr = s => s === '' ? null : (isNaN(Number(s)) ? s : Number(s));

        await db.collection('cards-meta').doc(metaDocId(cardId)).set({
          cardId,
          nombre,
          tipo,
          subtipo:    editingMeta.subtipo.trim()    || null,
          subsubtipo: editingMeta.subsubtipo.trim() || null,
          frameKey:   editingMeta.frameKey,
          efecto:     editingMeta.efecto,
          ataque:     numOrStr(atkStr),
          vida:       numOrStr(vidStr),
          artUrl:     artUrl || null,
          renderedUrl,
          custom:     isCreate || !rawCards.value.find(c => c.id === cardId),
          updatedAt:      firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy:      currentUser.value.uid,
          updatedByEmail: currentUser.value.email,
        }, { merge: true });

        saveMetaStatus.value = 'saved';
        setTimeout(() => { if (saveMetaStatus.value === 'saved') saveMetaStatus.value = ''; }, 2500);
        // Tras guardar, dejamos el editor abierto pero limpiamos el File para
        // evitar re-subidas accidentales.
        editingMeta.artFile = null;
        if (editingMeta.artLocalUrl) {
          URL.revokeObjectURL(editingMeta.artLocalUrl);
          editingMeta.artLocalUrl = '';
        }
        editingMeta.artUrl = artUrl;
      } catch (e) {
        console.error('save meta error', e);
        saveMetaError.value = 'No se pudo guardar: ' + (e.message || e);
      } finally {
        savingMeta.value = false;
        saveProgress.value = 'Guardando...';
      }
    }

    // ── Helpers ────────────────────────────────
    function formatDate(ts) {
      if (!ts) return '';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // Resetear paginación al cambiar filtros/búsqueda
    watch(filteredCards, () => { visibleCount.value = PAGE; });

    // ── Lifecycle ──────────────────────────────
    onMounted(() => {
      // IntersectionObserver: cargar más cartas al llegar al final del grid
      const sentinel = document.getElementById('grid-sentinel');
      if (sentinel) {
        new IntersectionObserver(entries => {
          if (entries[0].isIntersecting && hasMore.value) loadMore();
        }, { rootMargin: '300px' }).observe(sentinel);
      }

      auth.onAuthStateChanged(user => {
        if (user && !isAllowed(user.email)) { auth.signOut(); return; }
        currentUser.value = user;
        authLoading.value = false;
        if (user) {
          loadCards();
          loadCardsMeta();
          subscribeToDecks();
          subscribeToCardsMeta();
        } else {
          unsubscribeFromDecks();
          unsubscribeFromCardsMeta();
          rawCards.value = [];
          seedMeta.value = {};
          loading.value  = true;
        }
      });
    });

    return {
      currentUser, authLoading, authMode, authEmail, authPassword, authPasswordConfirm, authError, authSubmitting,
      login, register, logout,
      allCards, loading, loadError,
      search, filterTipo, filterSubtipo, filterSubsubtipo,
      tipoOptions, subtipoOptions, subsubtipoOptions, filteredCards,
      setTipo, setSubtipo,
      view, showDeck, selectedCard, openModal,
      deckName, activeSection, partyCards, mainCards, benchCards, fichaCards,
      partyTotal, mazoTotal, banquilloTotal, fichaTotal, deckTotal,
      activeCards, sectionTotalByKey,
      saving, validationMsg,
      addToDeck, decrementCard, cardInActiveSection, cardSections,
      clearDeck, newDeck, loadDeck, editingDeckId,
      savedDecks, deckFilter, filteredSavedDecks, myDecks,
      saveDeck, deleteDeck, deckCardCount, sectionCount,
      hoveredCard, zoomStyle, startHover, startHoverById, moveHover, endHover,
      exportCurrentToTTS, exportSavedToTTS,
      exportDecksJson, importDecksJson, importMsg,
      formatDate, cardUrl, webUrl,
      visibleCards, hasMore, loadMore,
      RULES,
      // Editor de carta
      editorOpen, editorMode, openCreator, closeEditor, previewCanvas,
      editingMeta, savingMeta, saveMetaStatus, saveMetaError, saveProgress,
      metaDirty, saveCardMeta, deleteCard, onArtUpload, loadArtFromUrl,
      loadingArt, artUrlError, frameHasStats,
      FRAMES_LIST, knownTipos, knownSubtipos,
    };
  }
}).mount('#app');
