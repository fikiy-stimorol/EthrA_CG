const { createApp, ref, computed, onMounted } = Vue;
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

function cardUrl(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function translateAuthError(code) {
  return ({
    'auth/invalid-email':        'Email inválido.',
    'auth/invalid-credential':   'Email o contraseña incorrectos.',
    'auth/user-not-found':       'No existe ninguna cuenta con ese email.',
    'auth/wrong-password':       'Contraseña incorrecta.',
    'auth/email-already-in-use': 'Este email ya está registrado.',
    'auth/weak-password':        'La contraseña debe tener al menos 6 caracteres.',
    'auth/too-many-requests':    'Demasiados intentos. Espera un momento.',
    'auth/network-request-failed': 'Sin conexión. Revisa tu red.',
  })[code] || 'Error de autenticación. Inténtalo de nuevo.';
}

// ── App ───────────────────────────────────────────────────────────
createApp({
  setup() {

    // ── Auth ───────────────────────────────────
    const currentUser          = ref(null);
    const authLoading          = ref(true);
    const authMode             = ref('login');   // 'login' | 'register'
    const authEmail            = ref('');
    const authPassword         = ref('');
    const authPasswordConfirm  = ref('');
    const authError            = ref('');
    const authSubmitting       = ref(false);

    async function login() {
      authSubmitting.value = true; authError.value = '';
      try { await auth.signInWithEmailAndPassword(authEmail.value.trim(), authPassword.value); }
      catch (e) { authError.value = translateAuthError(e.code); }
      finally { authSubmitting.value = false; }
    }

    async function register() {
      if (authPassword.value !== authPasswordConfirm.value) {
        authError.value = 'Las contraseñas no coinciden.'; return;
      }
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
      } catch {
        loadError.value = true;
      } finally {
        loading.value = false;
      }
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

    function setTipo(tipo)   { filterTipo.value = tipo;   filterSubtipo.value = 'todos'; filterSubsubtipo.value = 'todos'; }
    function setSubtipo(s)   { filterSubtipo.value = s;   filterSubsubtipo.value = 'todos'; }

    // ── UI state ───────────────────────────────
    const view         = ref('gallery');
    const showDeck     = ref(false);
    const selectedCard = ref(null);

    // ── Deck builder ───────────────────────────
    const deckName      = ref('Nuevo Mazo');
    const deckCards     = ref([]);
    const editingDeckId = ref(null);
    const saving        = ref(false);

    const deckTotal = computed(() => deckCards.value.reduce((s, e) => s + e.count, 0));

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

    function cardInDeck(card) { return deckCards.value.find(e => e.card.id === card.id)?.count || 0; }
    function clearDeck()      { deckCards.value = []; }
    function newDeck()        { deckCards.value = []; deckName.value = 'Nuevo Mazo'; editingDeckId.value = null; }

    function loadDeck(deck) {
      deckName.value = deck.name;
      // Solo mantener el ID de edición si el mazo es tuyo; si no, se guardará como uno nuevo (fork)
      editingDeckId.value = deck.uid === currentUser.value?.uid ? deck.id : null;
      deckCards.value = deck.cards.map(e => {
        const card = allCards.value.find(c => c.id === e.cardId);
        return card ? { card, count: e.count } : null;
      }).filter(Boolean);
      view.value = 'gallery';
      showDeck.value = true;
    }

    // ── Firestore: mazos ───────────────────────
    const savedDecks = ref([]);
    const deckFilter = ref('all');
    let   unsubscribeDecks = null;

    const myDecks = computed(() => savedDecks.value.filter(d => d.uid === currentUser.value?.uid));

    const filteredSavedDecks = computed(() =>
      deckFilter.value === 'mine' ? myDecks.value : savedDecks.value
    );

    function subscribeToDecks() {
      if (unsubscribeDecks) unsubscribeDecks();
      unsubscribeDecks = db.collection('decks')
        .orderBy('savedAt', 'desc')
        .limit(200)
        .onSnapshot(snap => {
          savedDecks.value = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }, err => console.error('Firestore error:', err));
    }

    function unsubscribeFromDecks() {
      if (unsubscribeDecks) { unsubscribeDecks(); unsubscribeDecks = null; }
      savedDecks.value = [];
    }

    async function saveDeck() {
      if (!deckCards.value.length || !currentUser.value) return;
      saving.value = true;
      const data = {
        name:        deckName.value || 'Mazo sin nombre',
        uid:         currentUser.value.uid,
        ownerEmail:  currentUser.value.email,
        cards: deckCards.value.map(e => ({
          cardId: e.card.id, nombre: e.card.nombre, tipo: e.card.tipo, count: e.count,
        })),
        savedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      try {
        if (editingDeckId.value) {
          await db.collection('decks').doc(editingDeckId.value).update(data);
        } else {
          const ref = await db.collection('decks').add(data);
          editingDeckId.value = ref.id;
        }
      } catch (e) { console.error('Error guardando mazo:', e); }
      finally { saving.value = false; }
    }

    async function deleteDeck(id) {
      try { await db.collection('decks').doc(id).delete(); }
      catch (e) { console.error('Error eliminando mazo:', e); }
      if (editingDeckId.value === id) newDeck();
    }

    function deckCardCount(deck) { return deck.cards.reduce((s, e) => s + e.count, 0); }

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

    function buildTTSJson(entries, deckName) {
      const BACK = PAGES_BASE + 'dorso.png';
      const deckIds = [], customDeck = {}, containedObjects = [];
      entries.forEach((entry, i) => {
        const idx = i + 1, cardId = idx * 100;
        const faceUrl = PAGES_BASE + entry.path.split('/').map(encodeURIComponent).join('/');
        customDeck[String(idx)] = { FaceURL: faceUrl, BackURL: BACK, NumWidth: 1, NumHeight: 1, BackIsHidden: true, UniqueBack: false, Type: 0 };
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
      const deckObject = containedObjects.length === 1
        ? { ...containedObjects[0], Transform: { posX:0, posY:1, posZ:0, rotX:0, rotY:180, rotZ:180, scaleX:1, scaleY:1, scaleZ:1 } }
        : {
            Name: 'Deck', Nickname: deckName, Description: '',
            Transform: { posX:0, posY:1, posZ:0, rotX:0, rotY:0, rotZ:180, scaleX:1, scaleY:1, scaleZ:1 },
            ColorDiffuse: { r:0.713, g:0.713, b:0.713 },
            Locked:false, Grid:true, Snap:true, IgnoreFoW:false, Autoraise:true,
            Sticky:true, Tooltip:true, GridProjection:false, HideWhenFaceDown:true,
            Hands:false, SidewaysCard:false,
            DeckIDs: deckIds, CustomDeck: customDeck,
            XmlUI:'', LuaScript:'', LuaScriptState:'',
            ContainedObjects: containedObjects,
            GUID: Math.random().toString(16).slice(2, 8),
          };
      return { SaveName: deckName, GameMode:'', Gravity:0.5, PlayArea:0.5, ObjectStates: [deckObject] };
    }

    function downloadFile(content, filename, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }

    function exportCurrentToTTS() {
      if (!deckCards.value.length) return;
      const entries = deckCards.value.map(e => ({ path: e.card.path, nombre: e.card.nombre, tipo: e.card.tipo, count: e.count }));
      downloadFile(JSON.stringify(buildTTSJson(entries, deckName.value), null, 2), deckName.value + '.json', 'application/json');
    }

    function exportSavedToTTS(deck) {
      const entries = deck.cards.map(e => ({ path: 'cartas/' + e.cardId + '.png', nombre: e.nombre, tipo: e.tipo, count: e.count }));
      downloadFile(JSON.stringify(buildTTSJson(entries, deck.name), null, 2), deck.name + '.json', 'application/json');
    }

    // ── JSON export/import (backup) ────────────
    const importMsg = ref('');

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
              name: deck.name, uid: currentUser.value.uid,
              ownerEmail: currentUser.value.email,
              cards: deck.cards,
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

    // ── Lifecycle ──────────────────────────────
    onMounted(() => {
      auth.onAuthStateChanged(user => {
        currentUser.value = user;
        authLoading.value = false;
        if (user) { loadCards(); subscribeToDecks(); }
        else { unsubscribeFromDecks(); allCards.value = []; loading.value = true; }
      });
    });

    return {
      // auth
      currentUser, authLoading, authMode, authEmail, authPassword, authPasswordConfirm, authError, authSubmitting,
      login, register, logout,
      // cards
      allCards, loading, loadError,
      // filters
      search, filterTipo, filterSubtipo, filterSubsubtipo,
      tipoOptions, subtipoOptions, subsubtipoOptions, filteredCards,
      setTipo, setSubtipo,
      // ui
      view, showDeck, selectedCard, openModal,
      // deck builder
      deckName, deckCards, saving, deckTotal, editingDeckId,
      addToDeck, decrementCard, cardInDeck, clearDeck, newDeck, loadDeck,
      // firestore decks
      savedDecks, deckFilter, filteredSavedDecks, myDecks,
      saveDeck, deleteDeck, deckCardCount,
      // zoom
      hoveredCard, zoomStyle, startHover, moveHover, endHover,
      // tts
      exportCurrentToTTS, exportSavedToTTS,
      // json backup
      exportDecksJson, importDecksJson, importMsg,
      // utils
      formatDate, cardUrl,
    };
  }
}).mount('#app');
