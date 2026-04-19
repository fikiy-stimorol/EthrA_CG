const { createApp, ref, computed, watch, onMounted } = Vue;
const db   = window.db;
const auth = window.auth;

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
    label: 'La Party', target: 10,
    hint: '1 héroe + 9 esbirros · sin repeticiones',
  },
  mazo: {
    label: 'El Deck', target: 40,
    hint: '40 cartas · máx. 2 copias por carta',
  },
  banquillo: {
    label: 'El Banquillo', target: 10,
    hint: '10 cartas · esbirros máx. 1 copia · sin héroes',
  },
};

function isHero(card)    { return card.tipo === 'personajes' && card.subtipo === 'Heroes'; }
function isEsbirro(card) { return card.tipo === 'personajes' && card.subtipo === 'Esbirros'; }

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
    if (total >= 40)
      return 'El Deck ya tiene 40 cartas.';
    if (exists && exists.count >= 2)
      return 'Máximo 2 copias por carta en el Deck.';
  }

  if (section === 'banquillo') {
    if (isHero(card))
      return 'El Banquillo no admite Héroes.';
    if (total >= 10)
      return 'El Banquillo ya tiene 10 cartas.';
    const max = isEsbirro(card) ? 1 : 2;
    if (exists && exists.count >= max)
      return isEsbirro(card)
        ? 'Los Esbirros solo pueden tener 1 copia en el Banquillo.'
        : 'Máximo 2 copias por carta en el Banquillo.';
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
    const allCards  = ref([]);
    const loading   = ref(true);
    const loadError = ref(false);

    async function loadCards() {
      try {
        const res = await fetch('cards.json');
        if (!res.ok) throw new Error();
        const paths = await res.json();
        allCards.value = paths.map(parseCard).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      } catch { loadError.value = true; }
      finally { loading.value = false; }
    }

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
        cards = cards.filter(c => c.nombre.toLowerCase().includes(q));
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
    const activeSection = ref('mazo');    // 'party' | 'mazo' | 'banquillo'
    const partyCards    = ref([]);
    const mainCards     = ref([]);
    const benchCards    = ref([]);
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
      return section === 'party' ? partyCards : section === 'mazo' ? mainCards : benchCards;
    }

    const partyTotal    = computed(() => partyCards.value.reduce((s, e) => s + e.count, 0));
    const mazoTotal     = computed(() => mainCards.value.reduce((s, e) => s + e.count, 0));
    const banquilloTotal= computed(() => benchCards.value.reduce((s, e) => s + e.count, 0));
    const deckTotal     = computed(() => partyTotal.value + mazoTotal.value + banquilloTotal.value);

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
      return sections;
    }

    function clearDeck() { sectionRef(activeSection.value).value = []; }
    function newDeck()   { partyCards.value = []; mainCards.value = []; benchCards.value = []; deckName.value = 'Nuevo Mazo'; editingDeckId.value = null; }

    function loadDeck(deck) {
      deckName.value = deck.name;
      editingDeckId.value = deck.uid === currentUser.value?.uid ? deck.id : null;
      const resolve = entries => (entries || []).map(e => {
        const card = allCards.value.find(c => c.id === e.cardId);
        return card ? { card, count: e.count } : null;
      }).filter(Boolean);
      if (deck.party !== undefined) {
        partyCards.value = resolve(deck.party);
        mainCards.value  = resolve(deck.mazo);
        benchCards.value = resolve(deck.banquillo);
      } else {
        // Formato antiguo: todo al deck principal
        partyCards.value = []; mainCards.value = resolve(deck.cards); benchCards.value = [];
      }
      view.value = 'gallery'; showDeck.value = true;
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
        return [...(deck.party||[]), ...(deck.mazo||[]), ...(deck.banquillo||[])].reduce((s,e)=>s+e.count,0);
      }
      return (deck.cards||[]).reduce((s,e)=>s+e.count,0);
    }

    function sectionCount(deck, key) {
      return (deck[key] || []).reduce((s,e)=>s+e.count,0);
    }

    // ── Zoom preview ───────────────────────────
    const hoveredCard = ref(null);
    const hoverX = ref(0), hoverY = ref(0);
    function startHover(card, e) { hoveredCard.value = card; hoverX.value = e.clientX; hoverY.value = e.clientY; }
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

    function openModal(card) { selectedCard.value = card; }

    // ── TTS export ─────────────────────────────
    const PAGES_BASE = 'https://fikiy-stimorol.github.io/EthrA_CG/';

    function buildTTSPile(entries, pileName, posX, idxOffset) {
      if (!entries.length) return null;
      const BACK = PAGES_BASE + 'dorso.png';
      const deckIds = [], customDeck = {}, containedObjects = [];
      entries.forEach((entry, i) => {
        const idx = idxOffset + i + 1, cardId = idx * 100;
        const faceUrl = PAGES_BASE + entry.path.split('/').map(encodeURIComponent).join('/');
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
      return cards.map(e => ({ path: e.card ? e.card.path : 'cartas/' + e.cardId + '.png',
        nombre: e.card ? e.card.nombre : e.nombre,
        tipo: e.card ? e.card.tipo : e.tipo, count: e.count }));
    }

    function makePiles(deck) {
      if (deck.party !== undefined) {
        return [
          { entries: toTTSEntries(deck.party    || []), name: 'La Party',     posX: -6 },
          { entries: toTTSEntries(deck.mazo     || []), name: 'El Deck',      posX:  0 },
          { entries: toTTSEntries(deck.banquillo|| []), name: 'El Banquillo', posX:  6 },
        ];
      }
      return [{ entries: toTTSEntries(deck.cards || []), name: deck.name, posX: 0 }];
    }

    function exportCurrentToTTS() {
      if (!deckTotal.value) return;
      const piles = makePiles({ party: serialize(partyCards.value), mazo: serialize(mainCards.value), banquillo: serialize(benchCards.value) });
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
        if (user) { loadCards(); subscribeToDecks(); }
        else { unsubscribeFromDecks(); allCards.value = []; loading.value = true; }
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
      deckName, activeSection, partyCards, mainCards, benchCards,
      partyTotal, mazoTotal, banquilloTotal, deckTotal,
      saving, validationMsg,
      addToDeck, decrementCard, cardInActiveSection, cardSections,
      clearDeck, newDeck, loadDeck, editingDeckId,
      savedDecks, deckFilter, filteredSavedDecks, myDecks,
      saveDeck, deleteDeck, deckCardCount, sectionCount,
      hoveredCard, zoomStyle, startHover, moveHover, endHover,
      exportCurrentToTTS, exportSavedToTTS,
      exportDecksJson, importDecksJson, importMsg,
      formatDate, cardUrl, webUrl,
      visibleCards, hasMore, loadMore,
      RULES,
    };
  }
}).mount('#app');
