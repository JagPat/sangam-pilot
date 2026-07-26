import { describe, expect, it } from 'vitest';
import { addServiceTotal } from './serviceTotals';

describe('addServiceTotal', () => {
  it('never combines different currencies', () => {
    const totals = {};
    addServiceTotal(totals, 'INR', 10000, 0, false);
    addServiceTotal(totals, 'USD', 2500, 5000, true);
    expect(totals).toEqual({
      INR: { hostCostCents: 10000, guestChargesCents: 0, outstanding: 0 },
      USD: { hostCostCents: 2500, guestChargesCents: 5000, outstanding: 1 },
    });
  });
});
