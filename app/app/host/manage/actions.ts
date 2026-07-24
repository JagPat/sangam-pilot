'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { serverClientRW } from '@/lib/supabase/serverClient';
import type { AppSupabaseClient } from '@/lib/supabase/clients';
import { getOperatorContext } from '@/lib/data/owner';

// Organizer guest + invitation management. Every write runs under the signed-in user's own session, so RLS
// is the real guard: the OWNER can write any guest; a bride/groom-side FAMILY ADMIN can only write rows on
// their own side (migration 0016) — a cross-side write is denied by the database, not just the UI. RSVPs are
// deliberately NOT touched here: attendance is written only through the two-step propose/confirm command
// path, and this screen never uses the service role.

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim();
}

function done(): never {
  revalidatePath('/host/manage');
  revalidatePath('/host');
  redirect('/host/manage?ok=1');
}

function fail(code: string): never {
  redirect(`/host/manage?err=${encodeURIComponent(code)}`);
}

// ---- Add a guest (into an existing or brand-new household), with an optional sign-in email ----
export async function addGuest(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const fullName = s(fd, 'fullName');
  const email = s(fd, 'email').toLowerCase();
  const householdId = s(fd, 'householdId');
  const newHousehold = s(fd, 'newHouseholdName');
  const chosenSide = s(fd, 'householdSide') || null;
  if (!weddingId || !fullName) fail('name');

  let ok = true;
  let code = 'save';
  try {
    const client = await serverClientRW();
    const app = client.schema('app');
    // A NEW household's side: the owner may choose one; a family admin's is forced to the side they manage
    // (the RLS WITH CHECK on household requires it, so this is what lets their insert succeed at all).
    const vc = (await getOperatorContext(client as unknown as AppSupabaseClient)).byWedding[weddingId] ?? { isOwner: false, adminGroupId: null };
    const newHouseholdSide = vc.isOwner ? chosenSide : vc.adminGroupId;

    let hhId = householdId;
    if (!hhId && newHousehold) {
      const { data, error } = await app.from('household').insert({ wedding_id: weddingId, name: newHousehold, host_group_id: newHouseholdSide }).select('id').single();
      if (error) throw error;
      hhId = data.id;
    }

    if (!hhId) {
      ok = false;
      code = 'household';
    } else {
      const { data: g, error: eg } = await app
        .from('guest')
        .insert({ wedding_id: weddingId, household_id: hhId, full_name: fullName })
        .select('id')
        .single();
      if (eg) throw eg;

      if (email) {
        const { error: ec } = await app
          .from('household_contact')
          .insert({ wedding_id: weddingId, household_id: hhId, guest_id: g.id, channel: 'email', value: email, is_shared: false });
        if (ec) throw ec;
      }
    }
  } catch (e) {
    console.error('[sangam manage] addGuest', e);
    ok = false;
    code = 'save';
  }
  if (!ok) fail(code);
  done();
}

// ---- Assign a household to a side (bride's/groom's/… host group). Owner-only in the UI; RLS also lets a
// family admin keep a household on their OWN side, but they can never move it to another side. Empty = clear. ----
export async function setHouseholdSide(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const householdId = s(fd, 'householdId');
  const hostGroupId = s(fd, 'hostGroupId') || null;
  if (!weddingId || !householdId) fail('save');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');
    const { error } = await app.from('household').update({ host_group_id: hostGroupId }).eq('wedding_id', weddingId).eq('id', householdId);
    if (error) throw error;
  } catch (e) {
    console.error('[sangam manage] setHouseholdSide', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// ---- Edit a guest's name / sign-in email ----
export async function updateGuest(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const guestId = s(fd, 'guestId');
  const householdId = s(fd, 'householdId');
  const fullName = s(fd, 'fullName');
  const email = s(fd, 'email').toLowerCase();
  const showInDirectory = !!fd.get('showInDirectory');
  if (!weddingId || !guestId) fail('save');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');

    // Always persist the directory-listing toggle; update the name only when one was supplied.
    const patch: { show_in_directory: boolean; full_name?: string } = { show_in_directory: showInDirectory };
    if (fullName) patch.full_name = fullName;
    {
      const { error } = await app.from('guest').update(patch).eq('wedding_id', weddingId).eq('id', guestId);
      if (error) throw error;
    }

    if (email) {
      const { data: c, error: eC } = await app
        .from('household_contact')
        .select('id')
        .eq('wedding_id', weddingId)
        .eq('guest_id', guestId)
        .eq('channel', 'email')
        .limit(1)
        .maybeSingle();
      if (eC) throw eC;
      if (c) {
        const { error } = await app.from('household_contact').update({ value: email }).eq('wedding_id', weddingId).eq('id', c.id);
        if (error) throw error;
      } else {
        const { error } = await app
          .from('household_contact')
          .insert({ wedding_id: weddingId, household_id: householdId, guest_id: guestId, channel: 'email', value: email, is_shared: false });
        if (error) throw error;
      }
    }
  } catch (e) {
    console.error('[sangam manage] updateGuest', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// ---- Record a guest's dietary needs (feeds the per-event caterer report). Runs under the OWNER's own
// session; the diet_self_write RLS policy (owner OR the guest/proxy) is the real guard. Leaving the
// category blank clears the profile, so the caterer report falls back to 'unknown' for that guest. ----
export async function saveDietary(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const guestId = s(fd, 'guestId');
  const category = s(fd, 'category');
  const jainRaw = s(fd, 'jainStrictness');
  const noOnionGarlic = !!fd.get('noOnionGarlic');
  const allergies = s(fd, 'allergies');
  if (!weddingId || !guestId) fail('save');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');

    if (!category) {
      const { error } = await app.from('guest_dietary_profile').delete().eq('wedding_id', weddingId).eq('guest_id', guestId);
      if (error) throw error;
    } else {
      // jain_strictness is only allowed when category = 'jain' (DB CHECK jain_strictness_only_for_jain).
      const jain = category === 'jain' && jainRaw ? jainRaw : null;
      const { error } = await app.from('guest_dietary_profile').upsert(
        {
          wedding_id: weddingId,
          guest_id: guestId,
          category,
          jain_strictness: jain,
          no_onion_garlic: noOnionGarlic,
          allergies: allergies || null,
        },
        { onConflict: 'wedding_id,guest_id' },
      );
      if (error) throw error;
    }
  } catch (e) {
    console.error('[sangam manage] saveDietary', e);
    ok = false;
  }
  if (!ok) fail('save');
  done();
}

// ---- Invite a guest to one event (find-or-create the household's invitation, mark it 'sent', add the guest) ----
export async function inviteGuest(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const guestId = s(fd, 'guestId');
  const householdId = s(fd, 'householdId');
  const instanceId = s(fd, 'instanceId');
  if (!weddingId || !guestId || !householdId || !instanceId) fail('invite');

  let ok = true;
  try {
    const app = (await serverClientRW()).schema('app');

    const { data: inv, error: eInv } = await app
      .from('invitation')
      .select('id, status')
      .eq('wedding_id', weddingId)
      .eq('household_id', householdId)
      .eq('event_instance_id', instanceId)
      .limit(1)
      .maybeSingle();
    if (eInv) throw eInv;

    let invId = inv?.id;
    if (!invId) {
      const { data: created, error: eC } = await app
        .from('invitation')
        .insert({ wedding_id: weddingId, household_id: householdId, event_instance_id: instanceId, status: 'sent' })
        .select('id')
        .single();
      if (eC) throw eC;
      invId = created.id;
    } else if (inv!.status !== 'sent') {
      const { error: eU } = await app.from('invitation').update({ status: 'sent' }).eq('wedding_id', weddingId).eq('id', invId);
      if (eU) throw eU;
    }

    // Idempotent: unique (wedding_id, event_instance_id, guest_id) — ignore a re-invite.
    const { error: eIg } = await app
      .from('invitation_guest')
      .upsert(
        { wedding_id: weddingId, invitation_id: invId, event_instance_id: instanceId, guest_id: guestId },
        { onConflict: 'wedding_id,event_instance_id,guest_id', ignoreDuplicates: true },
      );
    if (eIg) throw eIg;
  } catch (e) {
    console.error('[sangam manage] inviteGuest', e);
    ok = false;
  }
  if (!ok) fail('invite');
  done();
}

// ---- Remove a guest from one event (only if they have not yet responded) ----
export async function uninviteGuest(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const guestId = s(fd, 'guestId');
  const instanceId = s(fd, 'instanceId');
  if (!weddingId || !guestId || !instanceId) fail('uninvite');

  let ok = true;
  let responded = false;
  try {
    const app = (await serverClientRW()).schema('app');

    const { data: ig, error: eIg } = await app
      .from('invitation_guest')
      .select('id')
      .eq('wedding_id', weddingId)
      .eq('event_instance_id', instanceId)
      .eq('guest_id', guestId)
      .limit(1)
      .maybeSingle();
    if (eIg) throw eIg;

    if (ig) {
      const { data: at, error: eAt } = await app
        .from('event_attendance')
        .select('id')
        .eq('wedding_id', weddingId)
        .eq('invitation_guest_id', ig.id)
        .limit(1)
        .maybeSingle();
      if (eAt) throw eAt;
      if (at) {
        responded = true; // preserve the RSVP + its audit trail; don't delete attendance from here
      } else {
        const { error: eD } = await app.from('invitation_guest').delete().eq('wedding_id', weddingId).eq('id', ig.id);
        if (eD) throw eD;
      }
    }
  } catch (e) {
    console.error('[sangam manage] uninviteGuest', e);
    ok = false;
  }
  if (responded) fail('responded');
  if (!ok) fail('uninvite');
  done();
}

// ---- Delete a guest entirely (only when they are not invited anywhere, to keep it non-destructive) ----
export async function removeGuest(fd: FormData): Promise<void> {
  const weddingId = s(fd, 'weddingId');
  const guestId = s(fd, 'guestId');
  if (!weddingId || !guestId) fail('remove');

  let code: string | null = null;
  try {
    const app = (await serverClientRW()).schema('app');
    // One atomic SECURITY DEFINER call: it authorizes the owner, refuses a still-invited guest (SQLSTATE
    // SA001 -> "remove from their events first"), then removes the guest AND all of its owned detail rows
    // (contact, dietary, directory consent, …) in a single transaction. The previous app-side two-step
    // delete could wipe a guest's contact and then fail the guest delete on a child FK — this cannot.
    const { error } = await app.rpc('owner_delete_guest', { p_wedding: weddingId, p_guest: guestId });
    if (error) {
      code = error.code === 'SA001' ? 'hasinvites' : 'remove';
      if (error.code !== 'SA001') console.error('[sangam manage] removeGuest', error);
    }
  } catch (e) {
    console.error('[sangam manage] removeGuest', e);
    code = 'remove';
  }
  if (code) fail(code);
  done();
}
