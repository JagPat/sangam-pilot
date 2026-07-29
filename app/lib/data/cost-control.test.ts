import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapCostControlWedding } from './cost-control';

describe('Cost Control data mapping',()=>{
  it('maps official totals and workflow rows without inventing family funding',()=>{
    const result=mapCostControlWedding(
      {id:'w1',title:'A & B'},['event_manager'],
      [{id:'c1',wedding_id:'w1',name:'Venue',sort_order:10}],
      [{id:'i1',wedding_id:'w1',cost_centre_id:'c1',title:'Ballroom',description:null,lifecycle_state:'approved',decision_due_at:null}],
      [{id:'e1',wedding_id:'w1',cost_item_id:'i1',version_number:1,total:118000,subtotal:100000,tax_rate:18,currency_code:'INR',state:'approved',scope_included:null,scope_excluded:null,remarks:null,decision_due_at:null}],
      [],[],[],
      [{wedding_id:'w1',currency_code:'INR',approved_estimate_total:118000,committed_total:0,invoiced_total:0,paid_total:0}],
    );
    expect(result.isEventManager).toBe(true);
    expect(result.isCostApprover).toBe(false);
    expect(result.items[0].estimates[0].total).toBe(118000);
    expect(result.summary[0]).toEqual({currency:'INR',approved:118000,committed:0,invoiced:0,paid:0});
    expect(JSON.stringify(result)).not.toMatch(/family|contribution|bank_account|funding_source/i);
  });
});

describe('Cost Control draft editing',()=>{
  it('keeps editable draft fields when mapping an estimate',()=>{
    const result=mapCostControlWedding(
      {id:'w1',title:'A & B'},['event_manager'],
      [{id:'c1',wedding_id:'w1',name:'Decor',sort_order:10}],
      [{id:'i1',wedding_id:'w1',cost_centre_id:'c1',title:'Stage',description:null,lifecycle_state:'planning',decision_due_at:null}],
      [{id:'e1',wedding_id:'w1',cost_item_id:'i1',version_number:1,total:118000,subtotal:100000,tax_rate:18,currency_code:'INR',state:'draft',scope_included:'Stage floral installation',scope_excluded:'Lighting',remarks:'Awaiting vendor reply',decision_due_at:'2026-08-01T00:00:00Z'}],
      [],[],[],[],
    );
    expect(result.items[0].estimates[0]).toMatchObject({
      id:'e1',scopeIncluded:'Stage floral installation',scopeExcluded:'Lighting',remarks:'Awaiting vendor reply',decisionDue:'2026-08-01T00:00:00Z',
    });
  });

  it('renders a saved draft form with its estimate ID',()=>{
    const page=readFileSync(resolve(process.cwd(),'app/host/cost-control/page.tsx'),'utf8');
    expect(page).toContain('<input type="hidden" name="estimateId" value={estimate.id}/>');
  });

  it('offers a revised estimate only after a non-draft version exists',()=>{
    const page=readFileSync(resolve(process.cwd(),'app/host/cost-control/page.tsx'),'utf8');
    expect(page).toContain("item.estimates.some((e)=>e.state!=='draft')");
  });
});
