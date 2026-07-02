import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCJApDVvk5Z_clBq-eXjcMTg1AosgnQ5j4",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "SERENOVA-ai.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://SERENOVA-ai-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "SERENOVA-ai",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "SERENOVA-ai.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "774322433457",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:774322433457:web:80bf5c87f7d6e332522190",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-CER3JC445L"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
export const functions = getFunctions(app, import.meta.env.VITE_FUNCTIONS_REGION || "us-central1");
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();
