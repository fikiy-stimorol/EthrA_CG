// cardRenderer.js ─ Motor de composición de cartas (marco + arte + textos + stats)
// Expone: window.CardRenderer { TYPE_TAXONOMY, TAXONOMY_BY_LABEL, renderCard, renderCardBlob, FRAME_URLS }

(function () {
  'use strict';

  const TYPE_TAXONOMY = [
    // Personajes
    { label: 'Personaje - Héroe',          code: 'A1',   tipo: 'personajes', subtipo: 'Heroes',      subsubtipo: null,        frame: 'heroes'    },
    { label: 'Personaje - Esbirro',        code: 'A2',   tipo: 'personajes', subtipo: 'Esbirros',    subsubtipo: null,        frame: 'eesbirros' },
    // Objetos
    { label: 'Objeto Desechable',          code: 'B1',   tipo: 'objetos',    subtipo: 'desechables', subsubtipo: null,        frame: 'objetos'   },
    { label: 'Objeto Desechable - Poción', code: 'B1.1', tipo: 'objetos',    subtipo: 'desechables', subsubtipo: 'Pocion',    frame: 'objetos'   },
    { label: 'Objeto Desechable - Trampa', code: 'B1.2', tipo: 'objetos',    subtipo: 'desechables', subsubtipo: 'Trampa',    frame: 'objetos'   },
    { label: 'Objeto Desechable - Tótem',  code: 'B1.3', tipo: 'objetos',    subtipo: 'desechables', subsubtipo: 'Totem',     frame: 'objetos'   },
    { label: 'Objeto - Equipo',            code: 'B2',   tipo: 'objetos',    subtipo: 'equipos',     subsubtipo: null,        frame: 'objetos'   },
    { label: 'Objeto - Base',              code: 'B3',   tipo: 'objetos',    subtipo: 'bases',       subsubtipo: null,        frame: 'objetos'   },
    // Maniobras
    { label: 'Maniobra - Normal',          code: 'C1',   tipo: 'maniobras',  subtipo: 'Normales',    subsubtipo: null,        frame: 'maniobras' },
    { label: 'Maniobra - Rápida',          code: 'C2',   tipo: 'maniobras',  subtipo: 'Rapidas',     subsubtipo: null,        frame: 'maniobras' },
    { label: 'Maniobra - Reacción',        code: 'C3',   tipo: 'maniobras',  subtipo: 'Reacciones',  subsubtipo: null,        frame: 'maniobras' },
    // Magias
    { label: 'Magia - Agua',               code: 'D1',   tipo: 'magia',      subtipo: 'agua',        subsubtipo: null,        frame: 'magia'     },
    { label: 'Magia - Arcana',             code: 'D2',   tipo: 'magia',      subtipo: 'arcana',      subsubtipo: null,        frame: 'magia'     },
    { label: 'Magia - Básica',             code: 'D3',   tipo: 'magia',      subtipo: 'basica',      subsubtipo: null,        frame: 'magia'     },
    { label: 'Magia - Fuego',              code: 'D4',   tipo: 'magia',      subtipo: 'fuego',       subsubtipo: null,        frame: 'magia'     },
    { label: 'Magia - Muerte',             code: 'D5',   tipo: 'magia',      subtipo: 'muerte',      subsubtipo: null,        frame: 'magia'     },
    { label: 'Magia - Naturaleza',         code: 'D6',   tipo: 'magia',      subtipo: 'naturaleza',  subsubtipo: null,        frame: 'magia'     },
    { label: 'Magia - Rayo',               code: 'D7',   tipo: 'magia',      subtipo: 'rayo',        subsubtipo: null,        frame: 'magia'     },
    { label: 'Magia - Vida',               code: 'D8',   tipo: 'magia',      subtipo: 'vida',        subsubtipo: null,        frame: 'magia'     },
    { label: 'Magia - Viento',             code: 'D9',   tipo: 'magia',      subtipo: 'viento',      subsubtipo: null,        frame: 'magia'     },
    // Fichas
    { label: 'Ficha Personaje - Esbirro',  code: 'E1',   tipo: 'fichas',     subtipo: 'Esbirro',     subsubtipo: null,        frame: 'eesbirros' },
    { label: 'Ficha Objeto Desechable',    code: 'E2',   tipo: 'fichas',     subtipo: 'Desechable',  subsubtipo: null,        frame: 'objetos'   },
    { label: 'Ficha Objeto - Equipo',      code: 'E3',   tipo: 'fichas',     subtipo: 'Equipo',      subsubtipo: null,        frame: 'objetos'   },
    { label: 'Ficha Objeto - Base',        code: 'E4',   tipo: 'fichas',     subtipo: 'Base',        subsubtipo: null,        frame: 'objetos'   },
  ];

  const TAXONOMY_BY_LABEL = Object.fromEntries(TYPE_TAXONOMY.map(t => [t.label, t]));
  const TAXONOMY_BY_CODE  = Object.fromEntries(TYPE_TAXONOMY.map(t => [t.code, t]));

  const FRAME_URLS = {
    heroes:    'heroes.png',
    eesbirros: 'eesbirros.png',
    objetos:   'objetos.png',
    maniobras: 'maniobras.png',
    magia:     'magia.png',
  };
  const STAT_LEFT  = 'thumb-statBoxLeft.png';
  const STAT_RIGHT = 'thumb-statBoxRight.png';

  // Dimensiones de salida del PNG compuesto. Igualamos la resolución de
  // las cartas existentes (1500x2100) para que la calidad sea consistente.
  const TARGET_W = 1500;
  const TARGET_H = 2100;

  // ── Cache de imágenes y de detección de hueco ─────────────────────
  const imageCache = new Map();
  const holeCache  = new Map();

  function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = e => { imageCache.delete(src); reject(e); };
      img.src = src;
    });
    imageCache.set(src, p);
    return p;
  }

  // Bounding box de píxeles transparentes → hueco para el arte.
  function detectArtHole(img, frameKey) {
    if (holeCache.has(frameKey)) return holeCache.get(frameKey);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = c.width, minY = c.height, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] < 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    const rect = found
      ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
      : { x: 0, y: 0, w: c.width, h: c.height };
    holeCache.set(frameKey, rect);
    return rect;
  }

  // ── Dibujo ───────────────────────────────────────────────────────

  function drawCover(ctx, img, x, y, w, h) {
    const ir = img.naturalWidth / img.naturalHeight;
    const tr = w / h;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (ir > tr) { // la imagen es más ancha → recortar laterales
      sw = img.naturalHeight * tr;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / tr;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function setFont(ctx, size, weight) {
    ctx.font = `${weight || 600} ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  }

  function drawText(ctx, text, x, y, opt = {}) {
    if (!text) return;
    const { size = 14, weight = 600, color = '#fff', stroke, strokeW = 0, align = 'left', baseline = 'alphabetic' } = opt;
    setFont(ctx, size, weight);
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (stroke && strokeW) {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeW;
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function wrapLines(ctx, text, maxW) {
    const lines = [];
    const paragraphs = text.split(/\n+/);
    for (const p of paragraphs) {
      const words = p.split(/\s+/);
      let current = '';
      for (const w of words) {
        const candidate = current ? current + ' ' + w : w;
        if (ctx.measureText(candidate).width <= maxW || !current) {
          current = candidate;
        } else {
          lines.push(current);
          current = w;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  // Dibuja texto ajustado al rectángulo, reduciendo tamaño si no cabe.
  function drawWrappedText(ctx, text, x, y, w, h, opt = {}) {
    if (!text) return;
    const { color = '#fff', weight = 500, align = 'left', minSize = 8 } = opt;
    let size = opt.size || 18;
    const lineHMul = opt.lineH || 1.22;
    while (size >= minSize) {
      setFont(ctx, size, weight);
      const lines = wrapLines(ctx, text, w);
      const lineH = Math.round(size * lineHMul);
      if (lines.length * lineH <= h) {
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'top';
        const xTxt = align === 'center' ? x + w / 2 : x;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], xTxt, y + i * lineH);
        }
        return;
      }
      size--;
    }
  }

  // Ajusta tamaño para que el texto quepa en maxW.
  function fitText(ctx, text, maxW, size, weight) {
    let s = size;
    while (s > 8) {
      setFont(ctx, s, weight);
      if (ctx.measureText(text).width <= maxW) return s;
      s--;
    }
    return s;
  }

  // ── Render principal ─────────────────────────────────────────────

  async function renderCard(meta) {
    const entry = TAXONOMY_BY_LABEL[meta.tipoLabel] || TYPE_TAXONOMY[0];
    const frameImg = await loadImage(FRAME_URLS[entry.frame]);
    const holeSrc = detectArtHole(frameImg, entry.frame);

    const W = TARGET_W, H = TARGET_H;
    const scaleX = W / frameImg.naturalWidth;
    const scaleY = H / frameImg.naturalHeight;
    const hole = {
      x: Math.round(holeSrc.x * scaleX),
      y: Math.round(holeSrc.y * scaleY),
      w: Math.round(holeSrc.w * scaleX),
      h: Math.round(holeSrc.h * scaleY),
    };

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Fondo del hueco (por si el arte no cubre del todo)
    ctx.fillStyle = '#111';
    ctx.fillRect(hole.x, hole.y, hole.w, hole.h);

    // Arte
    if (meta.artUrl) {
      try {
        const art = await loadImage(meta.artUrl);
        drawCover(ctx, art, hole.x, hole.y, hole.w, hole.h);
      } catch (e) { /* noop */ }
    }

    // Marco encima, escalado a la resolución de salida
    ctx.drawImage(frameImg, 0, 0, W, H);

    // Banner semitransparente para el nombre (dentro del área de arte, arriba)
    const nameBandH = Math.round(hole.h * 0.14);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(hole.x, hole.y, hole.w, nameBandH);

    // Nombre
    const nameSize = Math.round(H * 0.046);
    const nameY = hole.y + Math.round(nameBandH * 0.72);
    const fittedName = fitText(ctx, meta.nombre || '', hole.w * 0.92, nameSize, 700);
    drawText(ctx, meta.nombre || '', W / 2, nameY, {
      size: fittedName, weight: 700, color: '#fff',
      stroke: '#000', strokeW: Math.max(3, Math.round(H * 0.003)), align: 'center',
    });

    // Área inferior: del fin del hueco al final de la carta
    const bandTop = hole.y + hole.h;
    const bandH   = H - bandTop;

    // Tipo / subtipo (justo encima del efecto)
    const typeSize = Math.round(H * 0.024);
    const typeY = bandTop + Math.round(bandH * 0.10);
    drawText(ctx, meta.tipoLabel || '', W / 2, typeY + typeSize, {
      size: typeSize, weight: 700, color: '#ffe9a8', stroke: '#000',
      strokeW: Math.max(2, Math.round(H * 0.002)), align: 'center',
    });

    // Efecto (wrap)
    const effTop    = typeY + typeSize + Math.round(bandH * 0.04);
    const effBottom = H - Math.round(H * 0.11); // deja aire para stats
    const effLeft   = Math.round(W * 0.08);
    const effRight  = W - Math.round(W * 0.08);
    drawWrappedText(ctx, meta.efecto || '', effLeft, effTop,
      effRight - effLeft, effBottom - effTop, {
        size: Math.round(H * 0.028), weight: 500, color: '#fff', align: 'center', lineH: 1.22,
      });

    // Stats (en las esquinas inferiores)
    if (meta.damage != null && meta.damage !== '') {
      const thumb = await loadImage(STAT_LEFT);
      const tw = Math.round(W * 0.26);
      const th = Math.round(tw * thumb.naturalHeight / thumb.naturalWidth);
      const tx = Math.round(W * 0.02);
      const ty = H - th - Math.round(H * 0.018);
      ctx.drawImage(thumb, tx, ty, tw, th);
      drawText(ctx, String(meta.damage), tx + tw / 2, ty + th / 2, {
        size: Math.round(th * 0.62), weight: 800, color: '#fff',
        stroke: '#000', strokeW: Math.max(3, Math.round(H * 0.003)), align: 'center', baseline: 'middle',
      });
    }
    if (meta.life != null && meta.life !== '') {
      const thumb = await loadImage(STAT_RIGHT);
      const tw = Math.round(W * 0.26);
      const th = Math.round(tw * thumb.naturalHeight / thumb.naturalWidth);
      const tx = W - tw - Math.round(W * 0.02);
      const ty = H - th - Math.round(H * 0.018);
      ctx.drawImage(thumb, tx, ty, tw, th);
      drawText(ctx, String(meta.life), tx + tw / 2, ty + th / 2, {
        size: Math.round(th * 0.62), weight: 800, color: '#fff',
        stroke: '#000', strokeW: Math.max(3, Math.round(H * 0.003)), align: 'center', baseline: 'middle',
      });
    }

    return canvas;
  }

  function renderCardBlob(meta, type = 'image/png', quality) {
    return renderCard(meta).then(canvas =>
      new Promise(resolve => canvas.toBlob(resolve, type, quality))
    );
  }

  window.CardRenderer = {
    TYPE_TAXONOMY,
    TAXONOMY_BY_LABEL,
    TAXONOMY_BY_CODE,
    FRAME_URLS,
    renderCard,
    renderCardBlob,
    loadImage,
  };
})();
