import { describe,expect,it } from 'vitest';
import { getEstimateDraftControls } from './cost-control';

describe('Cost Control estimate draft controls',()=>{
  it('offers the first draft when an item has no estimates',()=>{
    expect(getEstimateDraftControls([])).toEqual({showCreateDraft:true,createDraftLabel:'Create estimate draft'});
  });

  it('does not offer another draft while any draft exists',()=>{
    expect(getEstimateDraftControls([{id:'draft-1',state:'draft',canEditDraft:true}])).toEqual({showCreateDraft:false,createDraftLabel:null});
  });

  it('offers a revised draft when only historical estimates exist',()=>{
    expect(getEstimateDraftControls([{id:'estimate-1',state:'approved',canEditDraft:false}])).toEqual({showCreateDraft:true,createDraftLabel:'Create a revised estimate'});
  });
});
