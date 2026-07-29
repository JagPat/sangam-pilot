import { describe,expect,it } from 'vitest';
import { navigationForRoles } from './nav';

describe('finance-aware organizer navigation',()=>{
  it('does not give a wedding administrator finance by implication',()=>{
    const nav=navigationForRoles(['wedding_owner']);
    expect(nav.roleLabel).toBe('Wedding administrator');
    expect(nav.sections.map((s)=>s.key)).not.toContain('finance');
    expect(nav.sections.map((s)=>s.key)).not.toContain('costs');
  });

  it('gives an event manager operational costs but not private finance',()=>{
    const nav=navigationForRoles(['event_manager']);
    expect(nav.roleLabel).toBe('Event manager');
    expect(nav.sections.map((s)=>s.key)).toContain('costs');
    expect(nav.sections.map((s)=>s.key)).not.toContain('finance');
  });

  it('gives a finance admin private finance and no manager cost authority by implication',()=>{
    const nav=navigationForRoles(['finance_admin']);
    expect(nav.roleLabel).toBe('Finance administrator');
    expect(nav.sections.map((s)=>s.key)).toContain('finance');
    expect(nav.sections.map((s)=>s.key)).not.toContain('costs');
  });

  it('unions explicit roles without treating platform administration as wedding finance',()=>{
    const nav=navigationForRoles(['wedding_owner','event_manager']);
    expect(nav.sections.map((s)=>s.key)).toContain('dashboard');
    expect(nav.sections.map((s)=>s.key)).toContain('costs');
    expect(nav.sections.map((s)=>s.key)).not.toContain('finance');
  });

  it('adds platform provisioning only for an explicit platform super-admin capability',()=>{
    expect(navigationForRoles([],true).sections.map((s)=>s.key)).toContain('platform');
    expect(navigationForRoles(['wedding_owner'],false).sections.map((s)=>s.key)).not.toContain('platform');
  });
});
