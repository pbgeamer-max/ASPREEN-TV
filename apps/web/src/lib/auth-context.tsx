'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  User,
  onAuthStateChanged,
} from 'firebase/auth';
import { getClientAuth } from './firebase';
import { api } from './api-client';

interface AuthContextType {
  user: User | { uid: string; email: string } | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginDemoAdmin: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  loginDemoAdmin: async () => {},
  logout: async () => {},
  resetPassword: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | { uid: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth) {
      // Check if session token exists in localStorage
      const token = api.getToken();
      if (token) {
        setUser({ uid: 'aspreen-admin-uid', email: 'admin@aspreen.tv' });
      }
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const idToken = await firebaseUser.getIdToken();
          await api.createSession(idToken);
        } catch (err) {
          console.error('Session establishment failed:', err);
        }
      } else {
        const token = api.getToken();
        if (token === 'mock-admin-token') {
          setUser({ uid: 'aspreen-admin-uid', email: 'admin@aspreen.tv' });
        } else {
          setUser(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const auth = getClientAuth();
      if (!auth) {
        // Fallback demo mode
        api.setToken('mock-admin-token');
        setUser({ uid: 'aspreen-admin-uid', email });
        await api.createSession('mock-admin-token');
        setLoading(false);
        return;
      }

      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();
      await api.createSession(idToken);
      setUser(cred.user);
    } finally {
      setLoading(false);
    }
  };

  const loginDemoAdmin = async () => {
    setLoading(true);
    try {
      api.setToken('mock-admin-token');
      setUser({ uid: 'aspreen-admin-uid', email: 'admin@aspreen.tv' });
      await api.createSession('mock-admin-token');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      const auth = getClientAuth();
      if (auth) {
        await signOut(auth);
      }
      await api.logout();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    const auth = getClientAuth();
    if (!auth) {
      throw new Error('Firebase Auth is not configured on this client.');
    }
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginDemoAdmin, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
