import { describe,expect,it } from 'vitest';
import { deriveDecisionQueue,type CostControlEstimate,type CostControlWedding } from './cost-control';

const estimate=(id:string,version:number,state:string,total:number):CostControlEstimate=>({
  id,version,state,total,subtotal:total,taxRate:0,currency:'INR',scopeIncluded:`Included ${id}`,
  scopeExcluded:`Excluded ${id}`,remarks:null,decisionDue:'2026-08-04T00:00:00Z',canEditDraft:false,
});

function wedding(estimates:CostControlEstimate[],committed=0):CostControlWedding{
  return {
    weddingId:'w1',title:'A & B',isEventManager:false,isCostApprover:true,
    centres:[{id:'entertainment',name:'Entertainment'}],
    items:[{
      id:'act',centreId:'entertainment',centreName:'Entertainment',title:'Headline act',description:null,
      state:'planning',decisionDue:null,estimates,
      commitments:committed?[{id:'c1',estimateId:'approved',reference:null,total:committed,currency:'INR',date:null,state:'approved'}]:[],
      invoices:[],
    }],
    summary:[],
  };
}

describe('Cost Control decision queue',()=>{
  it('shows the previous version and current approved baseline independently',()=>{
    const queue=deriveDecisionQueue(wedding([
      estimate('submitted',3,'submitted',3900000),
      estimate('previous',2,'revision_required',4400000),
      estimate('approved',1,'approved',3400000),
    ],4350000));

    expect(queue[0]).toMatchObject({
      itemId:'act',
      estimate:{id:'submitted',version:3,total:3900000},
      previousVersion:{id:'previous',version:2,total:4400000},
      approvedBaseline:{id:'approved',version:1,total:3400000},
      changeFromPrevious:-500000,
      changeFromApproved:500000,
      exposure:950000,
    });
  });

  it('labels a first approval without inventing an approved comparison',()=>{
    const queue=deriveDecisionQueue(wedding([
      estimate('submitted',2,'under_review',2050000),
      estimate('previous',1,'revision_required',2400000),
    ]));

    expect(queue[0].approvedBaseline).toBeNull();
    expect(queue[0].changeFromApproved).toBeNull();
    expect(queue[0].changeFromPrevious).toBe(-350000);
  });

  it('excludes drafts and completed decisions',()=>{
    const queue=deriveDecisionQueue(wedding([
      estimate('draft',4,'draft',1),
      estimate('approved',3,'approved',1),
      estimate('rejected',2,'rejected',1),
    ]));

    expect(queue).toEqual([]);
  });
});
