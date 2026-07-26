export type CurrencyServiceTotal = { hostCostCents: number; guestChargesCents: number; outstanding: number };
export type ServiceTotals = Record<string, CurrencyServiceTotal>;

export function addServiceTotal(
  totals: ServiceTotals,
  currency: string,
  hostCostCents: number,
  guestChargesCents: number,
  outstanding: boolean,
): void {
  const total = (totals[currency] ??= { hostCostCents: 0, guestChargesCents: 0, outstanding: 0 });
  total.hostCostCents += hostCostCents;
  total.guestChargesCents += guestChargesCents;
  if (outstanding) total.outstanding += 1;
}
