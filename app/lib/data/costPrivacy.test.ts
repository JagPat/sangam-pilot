import { describe,expect,it } from 'vitest';
import { validateOfficialCostText } from './costPrivacy';

describe('validateOfficialCostText',()=>{
  it.each([
    'Stage floral installation',
    'Vendor invoice INV-42',
    'Reference: DECOR-2026-07',
  ])('accepts ordinary official cost text: %s',(value)=>{
    expect(validateOfficialCostText(value)).toEqual({ok:true});
  });

  it.each([
    'Bank account: 1234567890',
    'IFSC: HDFC0001234',
    'Card number 4111 1111 1111 1111',
    'Source of funds: savings',
    'Funding source: savings',
    'Contribution from aunt',
    'Family settlement agreed privately',
  ])('rejects explicit private-finance labels: %s',(value)=>{
    expect(validateOfficialCostText(value)).toMatchObject({ok:false});
  });
});
