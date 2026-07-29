import { describe,expect,it } from 'vitest';
import { navigationForRoles } from './nav';

describe('Cost Control organizer navigation',()=>{
  it('does not give a wedding administrator cost authority by implication',()=>{
    const nav=navigationForRoles(['wedding_owner']);
    expect(nav.roleLabel).toBe('Wedding administrator');
    expect(nav.sections.map((s)=>s.key)).not.toContain('cost-control');
    expect(nav.sections.map((s)=>s.key)).not.toContain('finance');
  });

  it('gives event managers the operational Cost Control surface',()=>{
    const nav=navigationForRoles(['event_manager']);
    expect(nav.roleLabel).toBe('Event manager');
    expect(nav.sections.map((s)=>s.key)).toContain('cost-control');
    expect(nav.sections.map((s)=>s.key)).not.toContain('finance');
  });

  it('gives cost approvers the same surface with independent authority',()=>{
    const nav=navigationForRoles(['cost_approver']);
    expect(nav.roleLabel).toBe('Cost approver');
    expect(nav.sections.map((s)=>s.key)).toEqual(['cost-control']);
  });

  it('does not surface retired private finance for a legacy finance role',()=>{
    const nav=navigationForRoles(['finance_admin']);
    expect(nav.sections.map((s)=>s.key)).not.toContain('finance');
    expect(nav.sections.map((s)=>s.key)).not.toContain('cost-control');
  });

  it('does not expose finance to family admins',()=>{
    const nav=navigationForRoles(['host_group_admin']);
    expect(nav.sections.map((s)=>s.key)).not.toContain('budget');
    expect(nav.sections.map((s)=>s.key)).not.toContain('cost-control');
  });

  it('adds platform provisioning only for an explicit platform super-admin capability',()=>{
    expect(navigationForRoles([],true).sections.map((s)=>s.key)).toContain('platform');
    expect(navigationForRoles(['wedding_owner'],false).sections.map((s)=>s.key)).not.toContain('platform');
  });
});
