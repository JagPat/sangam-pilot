import { describe,expect,it } from 'vitest';
import { validateOfficialCostText } from './costPrivacy';

describe('validateOfficialCostText',()=>{
  it.each([
    'Stage floral installation',
    'Vendor invoice INV-42',
    'Reference: DECOR-2026-07',
    'Vendor account manager on site',
    'Account setup for the vendor portal',
    'Bank liaison for the venue permit',
    'Place cards for dinner seating',
    'Family coordination desk',
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
    'Family balance: 500000',
    'Available family balance: 500000',
    'Payer family: bride',
    'Paid by family: groom',
    'Account number: 1234567890',
    'Account no. 1234567890',
    'Bank detail: call the host',
    'Bank details: call the host',
    'Card detail: personal',
    'Card details: personal',
    'Credit card details: personal',
    'Debit card details: personal',
    'Family funding: savings',
    'Family fundings: savings',
  ])('rejects explicit private-finance labels: %s',(value)=>{
    expect(validateOfficialCostText(value)).toMatchObject({ok:false});
  });
});
