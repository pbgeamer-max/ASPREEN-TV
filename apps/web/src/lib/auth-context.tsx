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
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  resetPassword: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | { uid: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const auth = getClientAuth();

    if (!auth) {
      // Validate saved token with backend session
      const token = api.getToken();
      if (token) {
        api.getSession()
          .then((res) => {
            if (isMounted) {
              if (res.authenticated && res.user) {
                setUser({ uid: res.user.uid, email: res.user.email });
              } else {
                api.setToken(null);
                setUser(null);
              }
            }
          })
          .catch(() => {
            if (isMounted) {
              api.setToken(null);
              setUser(null);
            }
          })
          .finally(() => {
            if (isMounted) setLoading(false);
          });
        return;
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
        if (token) {
          try {
            const res = await api.getSession();
            if (res.authenticated && res.user) {
              setUser({ uid: res.user.uid, email: res.user.email });
            } else {
              api.setToken(null);
              setUser(null);
            }
          } catch {
            api.setToken(null);
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
      if (isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      // 1. Direct Railway password authentication
      try {
        const res = await api.loginWithPassword(password, email);
        if (res.success && res.user) {
          setUser({ uid: res.user.uid, email: res.user.email });
          return;
        }
      } catch (err: any) {
        // If direct password login fails, check if client Firebase auth is configured
        const auth = getClientAuth();
        if (!auth) {
          throw err;
        }
        try {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          const idToken = await cred.user.getIdToken();
          await api.createSession(idToken);
          setUser(cred.user);
        } catch {
          throw err;
        }
      }
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
    <AuthContext.Provider value={{ user, loading, login, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
