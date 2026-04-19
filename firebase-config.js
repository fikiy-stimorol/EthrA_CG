// ─────────────────────────────────────────────────────────────────────────────
// INSTRUCCIONES DE CONFIGURACIÓN:
//
// 1. Ve a https://console.firebase.google.com y crea un proyecto nuevo
// 2. En el proyecto: ⚙️ Configuración → General → "Tu aplicación web" → Agregar app
// 3. Copia el objeto firebaseConfig que te dan y pégalo abajo
// 4. En Firebase Console → Authentication → Primeros pasos → Email/contraseña → Habilitar
// 5. En Firebase Console → Firestore Database → Crear base de datos → Modo producción
// 6. En Firestore → Reglas, reemplaza el contenido por esto y publica:
//
//    rules_version = '2';
//    service cloud.firestore {
//      match /databases/{database}/documents {
//        match /decks/{deckId} {
//          allow read  : if request.auth != null;
//          allow create: if request.auth != null;
//          allow update, delete: if request.auth != null
//                             && request.auth.uid == resource.data.uid;
//        }
//      }
//    }
//
// ─────────────────────────────────────────────────────────────────────────────

firebase.initializeApp({
  apiKey:            "AIzaSyAB24rU0MhHUNjO9fEcnPpa6Oy3LdkRu6g",
  authDomain:        "ethracg.firebaseapp.com",
  projectId:         "ethracg",
  storageBucket:     "ethracg.firebasestorage.app",
  messagingSenderId: "772205753962",
  appId:             "1:772205753962:web:deb07f35f52a1df811bc13"
});

window.db   = firebase.firestore();
window.auth = firebase.auth();

// ── Emails autorizados ────────────────────────────────────────────
// Solo estas personas pueden registrarse y acceder a la app.
// Para añadir a alguien nuevo, añade su email aquí y haz push.
window.ALLOWED_EMAILS = [
  'alexfandila@gmail.com',   // añade aquí los emails de tus 3 amigos
  'rbunce98@gmail.com',
  'guillermo13gn@gmail.com',
  'nacho1999ol@gmail.com',
];
