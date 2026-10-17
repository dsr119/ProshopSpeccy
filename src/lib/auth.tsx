import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { setSessionErrorHandler } from './errors';
import { clearLocalUserData } from './recent';

export interface Membership {
  shop_id: string;
  role: 'admin' | 'staff';
  active: boolean;
  display_name: string | null;
  email: string | null;
  shop_name: string | null;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  userId: string | null;
  membership: Membership | null;
  membershipError: string | null;
  sessionExpired: boolean;
  signOut: () => Promise<void>;
  reloadMembership: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const signingOut = useRef(false);
  const userId = session?.user.id ?? null;

  const loadMembership = useCallback(async (uid: string | null) => {
    setMembershipError(null);
    if (!uid) {
      setMembership(null);
      return;
    }
    const { data, error } = await supabase
      .from('staff_memberships')
      .select('shop_id, role, active, display_name, email, shops(name)')
      .eq('user_id', uid)
      .eq('active', true)
      .order('created_at')
      .limit(1);
    if (error) {
      setMembershipError(error.message);
      setMembership(null);
      return;
    }
    const row = data?.[0] as unknown as (Omit<Membership, 'shop_name'> & { shops: { name: string } | null }) | undefined;
    setMembership(row ? { ...row, shop_name: row.shops?.name ?? null } : null);
  }, []);

  const [sessionChecked, setSessionChecked] = useState(false);
  const [membershipFor, setMembershipFor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT' && !signingOut.current) setSessionExpired(true);
      if (event === 'SIGNED_IN') setSessionExpired(false);
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sessionChecked) return;
    let cancelled = false;
    loadMembership(userId).then(() => {
      if (!cancelled) setMembershipFor(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionChecked, userId, loadMembership]);

  const loading = !sessionChecked || membershipFor !== userId;

  useEffect(() => {
    setSessionErrorHandler(() => {
      setSessionExpired(true);
      // Drop the stale session locally; the server will refuse it anyway.
      supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    });
    return () => setSessionErrorHandler(null);
  }, []);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    clearLocalUserData();
    await supabase.auth.signOut().catch(() => supabase.auth.signOut({ scope: 'local' }));
    setMembership(null);
    setSessionExpired(false);
    signingOut.current = false;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      userId,
      membership,
      membershipError,
      sessionExpired,
      signOut,
      reloadMembership: () => loadMembership(userId),
    }),
    [loading, session, userId, membership, membershipError, sessionExpired, signOut, loadMembership],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For pages behind the membership gate: the membership is always present. */
export function useMembership(): Membership & { userId: string } {
  const { membership, userId } = useAuth();
  if (!membership || !userId) throw new Error('No active membership');
  return { ...membership, userId };
}
