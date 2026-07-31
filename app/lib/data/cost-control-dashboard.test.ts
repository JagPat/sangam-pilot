import { describe,expect,it } from 'vitest';
import { deriveCostControlDashboard,type CostControlWedding } from './cost-control';

function wedding(items:CostControlWedding['items'],summary:CostControlWedding['summary']):CostControlWedding{
  return {
    weddingId:'w1',
    title:'A & B',
    isEventManager:true,
    isCostApprover:false,
    centres:[
      {id:'decor',name:'Decor'},
      {id:'travel',name:'Transport'},
    ],
    items,
    summary,
  };
}

function item(
  id:string,
  centreId:string,
  centreName:string,
  estimates:CostControlWedding['items'][number]['estimates'],
  commitments:CostControlWedding['items'][number]['commitments'],
  invoices:CostControlWedding['items'][number]['invoices']=[],
):CostControlWedding['items'][number]{
  return {
    id,centreId,centreName,title:id,description:null,state:'planning',decisionDue:null,
    estimates,commitments,invoices,
  };
}

const estimate=(id:string,state:string,total:number,currency='INR',version=1)=>({
  id,version,subtotal:total,taxRate:0,total,currency,state,scopeIncluded:null,scopeExcluded:null,
  remarks:null,decisionDue:null,canEditDraft:false,
});

const commitment=(id:string,total:number,currency='INR',state='approved')=>({
  id,estimateId:`estimate-${id}`,reference:null,total,currency,date:null,state,
});

describe('Cost Control official-position dashboard',()=>{
  it('rolls up positive item exposure without netting an overrun against another item',()=>{
    const result=deriveCostControlDashboard(wedding([
      item('stage','decor','Decor',[estimate('e1','approved',100)],[commitment('c1',130)]),
      item('flowers','decor','Decor',[estimate('e2','approved',100)],[commitment('c2',50)]),
    ],[{currency:'INR',approved:200,committed:180,invoiced:0,paid:0}]));

    expect(result.centres).toEqual([{
      centreId:'decor',
      centreName:'Decor',
      currency:'INR',
      approved:200,
      committed:180,
      exposure:30,
      exposedItems:1,
      invoiced:0,
      paid:0,
    }]);
  });

  it('keeps currencies separate throughout centre exposure',()=>{
    const result=deriveCostControlDashboard(wedding([
      item('inr','travel','Transport',[estimate('e1','approved',100,'INR')],[commitment('c1',110,'INR')]),
      item('usd','travel','Transport',[estimate('e2','approved',200,'USD')],[commitment('c2',240,'USD')]),
    ],[
      {currency:'INR',approved:100,committed:110,invoiced:0,paid:0},
      {currency:'USD',approved:200,committed:240,invoiced:0,paid:0},
    ]));

    expect(Object.fromEntries(result.centres.map((row)=>[row.currency,row.exposure]))).toEqual({
      INR:10,
      USD:40,
    });
  });

  it('derives attention counts only from official workflow state',()=>{
    const receivedInvoice={
      id:'invoice-1',commitmentId:null,reference:'INV-1',subtotal:50,taxRate:0,total:50,currency:'INR',
      dueDate:null,state:'received',payments:[],
    };
    const result=deriveCostControlDashboard(wedding([
      item('awaiting','decor','Decor',[estimate('e1','submitted',100)],[]),
      item('review','decor','Decor',[estimate('e2','under_review',100)],[]),
      item('empty','travel','Transport',[],[]),
      item('invoice','travel','Transport',[estimate('e3','approved',50)],[],[receivedInvoice]),
    ],[]));

    expect(result.attention).toEqual({
      awaitingDecisions:2,
      exposedItems:0,
      unestimatedItems:1,
      unverifiedInvoices:1,
    });
  });

  it('excludes disputed and void invoices from the centre official position',()=>{
    const invoice=(id:string,state:string,total:number)=>({
      id,commitmentId:null,reference:id,subtotal:total,taxRate:0,total,currency:'INR',
      dueDate:null,state,payments:[],
    });
    const result=deriveCostControlDashboard(wedding([
      item('invoice','travel','Transport',[estimate('e1','approved',100)],[],[
        invoice('verified','verified',100),
        invoice('disputed','disputed',200),
        invoice('void','void',300),
      ]),
    ],[{currency:'INR',approved:100,committed:0,invoiced:100,paid:0}]));

    expect(result.centres[0]?.invoiced).toBe(100);
  });
});
