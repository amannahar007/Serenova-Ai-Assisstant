import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCJApDVvk5Z_clBq-eXjcMTg1AosgnQ5j4").trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "divu-ai.firebaseapp.com").trim(),
  databaseURL: (import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://divu-ai-default-rtdb.firebaseio.com").trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || "divu-ai").trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "divu-ai.firebasestorage.app").trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "774322433457").trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || "1:774322433457:web:80bf5c87f7d6e332522190").trim(),
  measurementId: (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-CER3JC445L").trim()
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export const functions = getFunctions(app, import.meta.env.VITE_FUNCTIONS_REGION || "us-central1");
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();
