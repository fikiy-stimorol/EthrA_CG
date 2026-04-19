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
  apiKey:            "PEGA_TU_API_KEY_AQUÍ",
  authDomain:        "TU_PROYECTO.firebaseapp.com",
  projectId:         "TU_PROYECTO_ID",
  storageBucket:     "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId:             "TU_APP_ID"
});

window.db   = firebase.firestore();
window.auth = firebase.auth();
