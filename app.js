const { createApp, ref, computed, onMounted } = Vue;


function parseCard(path) {
  const withoutPrefix = path.slice('cartas/'.length);
  const parts = withoutPrefix.split('/');
  const baseName = parts[parts.length - 1].replace('.png', '');
  const m = baseName.match(/^(.+?)(?:\s+\((\d+)\))?$/);
  const nombre = m ? m[1].trim() : baseName;
  const copies = m && m[2] ? parseInt(m[2]) : 1;
  const tipo       = parts[0];
  const subtipo    = parts.length >= 3 ? parts[1] : null;
  const subsubtipo = parts.length >= 4 ? parts[2] : null;
  return { id: withoutPrefix.replace('.png', ''), path, nombre, copies, tipo, subtipo, subsubtipo };
}

function cardUrl(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

createApp({
  setup() {
    // ── Estado principal ───────────────────────
    const allCards   = ref([]);
    const loading    = ref(true);
    const loadError  = ref(false);

    const search           = ref('');
    const filterTipo       = ref('todos');
    const filterSubtipo    = ref('todos');
    const filterSubsubtipo = ref('todos');
    const view     = ref('gallery');
    const showDeck = ref(false);
    const selectedCard = ref(null);

    const deckName      = ref('Nuevo Mazo');
    const deckCards     = ref([]);
    const savedDecks    = ref([]);
    const editingDeckId = ref(null);
    const importMsg     = ref('');

    const hoveredCard = ref(null);
    const hoverX = ref(0);
    const hoverY = ref(0);

    // ── Filtros dinámicos (derivados de las carpetas reales) ───
    const tipoOptions = computed(() => {
      const tipos = [...new Set(allCards.value.map(c => c.tipo))].sort();
      return [{ value: 'todos', label: 'Todos' }, ...tipos.map(t => ({ value: t, label: cap(t) }))];
    });

    const subtipoOptions = computed(() => {
      if (filterTipo.value === 'todos') return [];
      const seen = new Set(
        allCards.value.filter(c => c.tipo === filterTipo.value && c.subtipo).map(c => c.subtipo)
      );
      if (!seen.size) return [];
      return [{ value: 'todos', label: 'Todos' }, ...[...seen].sort().map(s => ({ value: s, label: cap(s) }))];
    });

    const subsubtipoOptions = computed(() => {
      if (filterSubtipo.value === 'todos') return [];
      const seen = new Set(
        allCards.value
          .filter(c => c.tipo === filterTipo.value && c.subtipo === filterSubtipo.value && c.subsubtipo)
          .map(c => c.subsubtipo)
      );
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
        cards = cards.filter(c => c.nombre.toLowerCase().includes(q));
      }
      return cards;
    });

    const deckTotal = computed(() => deckCards.value.reduce((s, e) => s + e.count, 0));

    // ── Filtros ────────────────────────────────
    function setTipo(tipo) {
      filterTipo.value = tipo;
      filterSubtipo.value = 'todos';
      filterSubsubtipo.value = 'todos';
    }
    function setSubtipo(subtipo) {
      filterSubtipo.value = subtipo;
      filterSubsubtipo.value = 'todos';
    }

    // ── Constructor de mazos ───────────────────
    function addToDeck(card) {
      const entry = deckCards.value.find(e => e.card.id === card.id);
      if (entry) entry.count++;
      else deckCards.value.push({ card, count: 1 });
      showDeck.value = true;
    }
    function decrementCard(card) {
      const idx = deckCards.value.findIndex(e => e.card.id === card.id);
      if (idx === -1) return;
      if (deckCards.value[idx].count <= 1) deckCards.value.splice(idx, 1);
      else deckCards.value[idx].count--;
    }
    function cardInDeck(card) {
      return deckCards.value.find(e => e.card.id === card.id)?.count || 0;
    }
    function clearDeck() { deckCards.value = []; }
    function newDeck() {
      deckCards.value = [];
      deckName.value = 'Nuevo Mazo';
      editingDeckId.value = null;
    }
    function saveDeck() {
      if (!deckCards.value.length) return;
      const data = {
        id: editingDeckId.value || String(Date.now()),
        name: deckName.value || 'Mazo sin nombre',
        cards: deckCards.value.map(e => ({ cardId: e.card.id, nombre: e.card.nombre, tipo: e.card.tipo, count: e.count })),
        savedAt: Date.now(),
      };
      if (editingDeckId.value) {
        const idx = savedDecks.value.findIndex(d => d.id === editingDeckId.value);
        if (idx !== -1) savedDecks.value[idx] = data;
        else savedDecks.value.push(data);
      } else {
        savedDecks.value.push(data);
        editingDeckId.value = data.id;
      }
      persist();
    }
    function loadDeck(deck) {
      deckName.value = deck.name;
      editingDeckId.value = deck.id;
      deckCards.value = deck.cards.map(e => {
        const card = allCards.value.find(c => c.id === e.cardId);
        return card ? { card, count: e.count } : null;
      }).filter(Boolean);
      view.value = 'gallery';
      showDeck.value = true;
    }
    function deleteDeck(id) {
      savedDecks.value = savedDecks.value.filter(d => d.id !== id);
      if (editingDeckId.value === id) newDeck();
      persist();
    }
    function deckCardCount(deck) { return deck.cards.reduce((s, e) => s + e.count, 0); }

    // ── Modal ──────────────────────────────────
    function openModal(card) { selectedCard.value = card; }

    // ── Zoom preview ───────────────────────────
    function startHover(card, e) { hoveredCard.value = card; hoverX.value = e.clientX; hoverY.value = e.clientY; }
    function moveHover(e) { hoverX.value = e.clientX; hoverY.value = e.clientY; }
    function endHover() { hoveredCard.value = null; }

    const ZOOM_W = 260, ZOOM_H = 364, PAD = 12;
    const zoomStyle = computed(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = hoverX.value + 20, y = hoverY.value - ZOOM_H / 2;
      if (x + ZOOM_W > vw - PAD) x = hoverX.value - ZOOM_W - 16;
      if (y < PAD) y = PAD;
      if (y + ZOOM_H > vh - PAD) y = vh - ZOOM_H - PAD;
      return { left: x + 'px', top: y + 'px' };
    });

    // ── Tabletop Simulator export ──────────────
    const PAGES_BASE = 'https://fikiy-stimorol.github.io/EthrA_CG/';

    function buildTTSJson(entries, deckName) {
      // entries: [{ path, nombre, tipo, count }]
      const BACK = PAGES_BASE + 'dorso.png';
      const deckIds = [], customDeck = {}, containedObjects = [];

      entries.forEach((entry, i) => {
        const idx = i + 1;
        const faceUrl = PAGES_BASE + entry.path.split('/').map(encodeURIComponent).join('/');
        const cardId = idx * 100;
        customDeck[String(idx)] = {
          FaceURL: faceUrl, BackURL: BACK,
          NumWidth: 1, NumHeight: 1,
          BackIsHidden: true, UniqueBack: false, Type: 0
        };
        for (let c = 0; c < entry.count; c++) {
          deckIds.push(cardId);
          containedObjects.push({
            Name: 'Card',
            Transform: { posX:0, posY:0, posZ:0, rotX:0, rotY:180, rotZ:180, scaleX:1, scaleY:1, scaleZ:1 },
            Nickname: entry.nombre,
            Description: entry.tipo || '',
            CardID: cardId,
            CustomDeck: { [String(idx)]: customDeck[String(idx)] },
            XmlUI:'', LuaScript:'', LuaScriptState:'',
            GUID: Math.random().toString(16).slice(2, 8)
          });
        }
      });

      const deckObject = containedObjects.length === 1
        ? { ...containedObjects[0], Transform: { posX:0, posY:1, posZ:0, rotX:0, rotY:180, rotZ:180, scaleX:1, scaleY:1, scaleZ:1 } }
        : {
            Name: 'Deck',
            Transform: { posX:0, posY:1, posZ:0, rotX:0, rotY:0, rotZ:180, scaleX:1, scaleY:1, scaleZ:1 },
            Nickname: deckName, Description: '',
            ColorDiffuse: { r:0.713235259, g:0.713235259, b:0.713235259 },
            Locked:false, Grid:true, Snap:true, IgnoreFoW:false, Autoraise:true,
            Sticky:true, Tooltip:true, GridProjection:false, HideWhenFaceDown:true,
            Hands:false, SidewaysCard:false,
            DeckIDs: deckIds, CustomDeck: customDeck,
            XmlUI:'', LuaScript:'', LuaScriptState:'',
            ContainedObjects: containedObjects,
            GUID: Math.random().toString(16).slice(2, 8)
          };

      return {
        SaveName: deckName, GameMode:'', Date:'', Gravity:0.5, PlayArea:0.5,
        Table:'', Sky:'', Note:'', Rules:'', XmlUI:'', LuaScript:'', LuaScriptState:'',
        ObjectStates: [deckObject]
      };
    }

    function downloadTTS(json, name) {
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name.replace(/[^\w\s-]/g, '').trim() + '.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    function exportCurrentToTTS() {
      if (!deckCards.value.length) return;
      const entries = deckCards.value.map(e => ({ path: e.card.path, nombre: e.card.nombre, tipo: e.card.tipo, count: e.count }));
      downloadTTS(buildTTSJson(entries, deckName.value), deckName.value);
    }

    function exportSavedToTTS(deck) {
      const entries = deck.cards.map(e => ({
        path: 'cartas/' + e.cardId + '.png',
        nombre: e.nombre, tipo: e.tipo, count: e.count
      }));
      downloadTTS(buildTTSJson(entries, deck.name), deck.name);
    }

    // ── Export / Import ────────────────────────
    function exportDecks() {
      if (!savedDecks.value.length) return;
      const blob = new Blob([JSON.stringify(savedDecks.value, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'ethra-mazos.json'; a.click();
      URL.revokeObjectURL(url);
    }
    function importDecks(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (!Array.isArray(imported)) throw new Error();
          const existingIds = new Set(savedDecks.value.map(d => d.id));
          let added = 0;
          for (const deck of imported) {
            if (!existingIds.has(deck.id)) { savedDecks.value.push(deck); added++; }
          }
          persist();
          importMsg.value = added ? `${added} mazo(s) importado(s) ✓` : 'Ya tenías todos esos mazos';
        } catch { importMsg.value = 'Archivo no válido'; }
        setTimeout(() => importMsg.value = '', 3000);
        event.target.value = '';
      };
      reader.readAsText(file);
    }

    // ── Persistencia ───────────────────────────
    function persist() {
      try { localStorage.setItem('ethra-decks', JSON.stringify(savedDecks.value)); } catch {}
    }
    function formatDate(ts) {
      return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // ── Inicialización ─────────────────────────
    onMounted(async () => {
      // Cargar mazos guardados
      try {
        const stored = localStorage.getItem('ethra-decks');
        if (stored) savedDecks.value = JSON.parse(stored);
      } catch {}

      // Cargar catálogo de cartas (generado automáticamente por GitHub Actions)
      try {
        const res = await fetch('cards.json');
        if (!res.ok) throw new Error(`cards.json ${res.status}`);
        const paths = await res.json();
        allCards.value = paths
          .map(parseCard)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      } catch (err) {
        console.error('Error cargando cartas:', err);
        loadError.value = true;
      } finally {
        loading.value = false;
      }
    });

    return {
      allCards, loading, loadError,
      search, filterTipo, filterSubtipo, filterSubsubtipo,
      view, showDeck, selectedCard,
      deckName, deckCards, savedDecks,
      tipoOptions, subtipoOptions, subsubtipoOptions,
      filteredCards, deckTotal,
      setTipo, setSubtipo,
      addToDeck, decrementCard, cardInDeck,
      clearDeck, newDeck, saveDeck,
      loadDeck, deleteDeck, deckCardCount,
      openModal, formatDate, cardUrl,
      hoveredCard, zoomStyle, startHover, moveHover, endHover,
      exportDecks, importDecks, importMsg,
      exportCurrentToTTS, exportSavedToTTS,
    };
  }
}).mount('#app');
