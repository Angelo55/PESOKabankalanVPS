import './bufferPolyfill'; // MUST be first — provides Buffer for @react-pdf/renderer image export
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css'; // <-- THIS IS THE MAGIC LINE THAT ENABLES TAILWIND!
import { GoogleOAuthProvider } from '@react-oauth/google';

// --- IMPORT OUR NEW AUTH PROVIDER ---
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Theme is app-wide (covers job-seeker, PESO-admin AND Super Admin shells), so
        it wraps everything and does not depend on auth. */}
    <ThemeProvider>
      <GoogleOAuthProvider clientId={clientId}>
        {/* WRAP THE APP IN THE SECURE AUTH CONTEXT */}
        <AuthProvider>
          <App />
        </AuthProvider>
      </GoogleOAuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);