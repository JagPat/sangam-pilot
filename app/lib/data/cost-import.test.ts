import { describe,expect,it } from 'vitest';
import { parseCostImportCsv,prepareCostImportRows } from './cost-import';

const header='source_line_id,title,subtotal,currency,tax_rate,cost_centre,match_item,scope_included,scope_excluded';

describe('official cost CSV import',()=>{
  it('parses quoted commas and normalizes official fields',()=>{
    const result=parseCostImportCsv(`${header}
line-1,"Sangeet act, headline",3900000,inr,18,Entertainment,Headline act,"Performance, rehearsal","Hotel, backline"`);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{
      sourceLineId:'line-1',
      title:'Sangeet act, headline',
      subtotal:3900000,
      currency:'INR',
      taxRate:18,
      centreName:'Entertainment',
      matchItemTitle:'Headline act',
      scopeIncluded:'Performance, rehearsal',
      scopeExcluded:'Hotel, backline',
    }]);
  });

  it('rejects duplicate source identities',()=>{
    const result=parseCostImportCsv(`${header}
same,Act,100,INR,0,Entertainment,,,
same,Decor,200,INR,0,Decor,,,`);

    expect(result.errors).toContain('Row 3: source_line_id "same" is duplicated.');
  });

  it('rejects invalid amounts, tax and unsupported currency',()=>{
    const result=parseCostImportCsv(`${header}
line-1,Act,-1,EUR,101,Entertainment,,,`);

    expect(result.errors).toEqual([
      'Row 2: subtotal must be zero or more.',
      'Row 2: currency must be INR or USD.',
      'Row 2: tax_rate must be between 0 and 100.',
    ]);
  });

  it('rejects private family-finance language before staging',()=>{
    const result=parseCostImportCsv(`${header}
line-1,Family contribution,100,INR,0,Entertainment,,,`);

    expect(result.errors).toEqual([
      'Row 2: Do not enter bank details, family contributions, funding sources or private settlements.',
    ]);
  });

  it('reports a malformed or incomplete header',()=>{
    const result=parseCostImportCsv('title,amount\nAct,100');

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain('CSV header must be');
  });

  it('uses only exact confirmed catalogue identities when preparing staging rows',()=>{
    const parsed=parseCostImportCsv(`${header}
line-1,Headline act,100,INR,0,Entertainment,Headline act,,
line-2,Airport transfers,200,INR,0,Transport,,,
line-3,Similar title,300,INR,0,Entertainment,headline,,
line-4,Unknown centre,400,INR,0,Missing,,,`);
    const prepared=prepareCostImportRows(parsed.rows,[
      {id:'centre-entertainment',name:'Entertainment'},
      {id:'centre-transport',name:'Transport'},
    ],[
      {id:'item-act',centreId:'centre-entertainment',title:'Headline act'},
    ]);

    expect(prepared.map((row)=>({
      id:row.source_line_id,resolution:row.resolution,centre:row.cost_centre_id,item:row.matched_cost_item_id,
    }))).toEqual([
      {id:'line-1',resolution:'matched',centre:'centre-entertainment',item:'item-act'},
      {id:'line-2',resolution:'create',centre:'centre-transport',item:null},
      {id:'line-3',resolution:'unresolved',centre:null,item:null},
      {id:'line-4',resolution:'unresolved',centre:null,item:null},
    ]);
  });
});
