import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/errors';

export interface StaffRow {
  shop_id: string;
  user_id: string;
  role: 'admin' | 'staff';
  active: boolean;
  display_name: string | null;
  email: string | null;
  created_at: string;
}

export async function listStaff(shopId: string): Promise<StaffRow[]> {
  return unwrap(
    await supabase.from('staff_memberships').select('*').eq('shop_id', shopId).order('active', { ascending: false }).order('email'),
  ) as StaffRow[];
}

export async function setStaff(shopId: string, email: string, role: string, active: boolean, displayName: string) {
  return unwrap(
    await supabase.rpc('admin_set_staff', {
      p_shop_id: shopId,
      p_email: email,
      p_role: role,
      p_active: active,
      p_display_name: displayName || null,
    }),
  ) as StaffRow;
}
