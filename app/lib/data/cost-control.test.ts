import { describe,expect,it } from 'vitest';
import { mapCostControlWedding } from './cost-control';

describe('Cost Control data mapping',()=>{
  it('maps official totals and workflow rows without inventing family funding',()=>{
    const result=mapCostControlWedding(
      {id:'w1',title:'A & B'},['event_manager'],
      [{id:'c1',wedding_id:'w1',name:'Venue',sort_order:10}],
      [{id:'i1',wedding_id:'w1',cost_centre_id:'c1',title:'Ballroom',description:null,lifecycle_state:'approved',decision_due_at:null}],
      [{id:'e1',wedding_id:'w1',cost_item_id:'i1',version_number:1,total:118000,subtotal:100000,tax_rate:18,currency_code:'INR',state:'approved',remarks:null}],
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
