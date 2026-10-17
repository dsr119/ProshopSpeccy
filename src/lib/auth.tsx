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
  /** True when access comes from the shop's open link rather than a staff account. */
  open?: boolean;
}

// Local storage keys and drafts for visitors using the open link.
const SHARED_USER = 'shared';

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
    if (uid) {
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
      if (row) {
        setMembership({ ...row, shop_name: row.shops?.name ?? null });
        return;
      }
    }
    // No staff membership: fall back to a shop that is open to anyone with the link.
    const { data: shops, error: shopError } = await supabase
      .from('shops')
      .select('id, name')
      .eq('open_access', true)
      .order('created_at')
      .limit(1);
    if (shopError) {
      setMembershipError(shopError.message);
      setMembership(null);
      return;
    }
    const shop = shops?.[0];
    setMembership(
      shop
        ? { shop_id: shop.id, role: 'staff', active: true, display_name: null, email: null, shop_name: shop.name, open: true }
        : null,
    );
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
  if (!membership) throw new Error('No active membership');
  return { ...membership, userId: userId ?? SHARED_USER };
}
