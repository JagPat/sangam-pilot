# Sangam Finance Privacy Boundary Design

**Date:** 2026-07-26  
**Status:** Approved product design  
**Scope:** Separate event-manager financial operations from private family funding and settlement data.

## 1. Outcome

An event manager manages the wedding's expenses, vendors, invoices, due dates, and payment progress. The manager treats the bride and groom as one wedding unit and must not learn:

- how much either family contributed;
- who contributed money;
- either family's available balance;
- which family paid a particular cost;
- bride/groom allocation percentages or settlement positions; or
- an amount from which those private values can be inferred.

For each currency, the manager sees only one manually published signal:

- `not_assessed` — no funding decision has been published;
- `funded` — the authorised finance administrator considers the currency funded; or
- `funds_needed` — the authorised finance administrator wants more funding arranged.

The signal includes `updated_at`, but no amount, contributor, family, explanatory note, or threshold.

## 2. Approved role model

### Platform super-admin

`jagrutpatel@gmail.com` is the initial platform super-admin. This is an account-level platform role, not the event-manager role and not a wedding-family role.

The platform super-admin can provision weddings, assign roles, inspect audit metadata, and invoke a logged break-glass workflow. It does not silently bypass wedding RLS during normal application use. Reading a family's private finance data requires an explicit, audited finance-admin assignment or break-glass action.

The email address is used once by a service-controlled provisioning migration or command to resolve the existing account ID. Runtime authorization uses the immutable account ID, never an email comparison supplied by a browser.

### Wedding administrator

The existing `wedding_owner` role remains responsible for wedding configuration and role assignment. It is no longer labelled “Event manager.” Wedding ownership alone does not grant private finance access.

### Event manager

A new `event_manager` wedding role may:

- create and update operational cost items;
- manage vendors, invoices, due dates, and payment status;
- see operational amounts and totals by currency;
- see the published funding signal by currency; and
- use the non-financial organizer modules already granted to the role.

It may not select private settlement, contribution, payer-family, allocation, or net-position data, either through tables, views, RPCs, or aggregate side channels.

### Finance administrator

A new `finance_admin` wedding role is assigned to the couple or a trusted family financial administrator. It may:

- see and maintain private payer and family-allocation information;
- maintain the private contribution ledger when that module is introduced;
- see private balances and settlement positions; and
- publish the manager-visible funding signal for each currency.

### Host-group administrator

`host_group_admin` retains its existing side-scoped finance access. It cannot see the other family's private contributions. It cannot publish the wedding-wide manager signal unless it is separately assigned `finance_admin`.

## 3. Chosen architecture

The finance model is split into two bounded domains.

### Operational cost domain

A new `finance_cost_item` table is the manager-facing source of truth:

- wedding and optional vendor engagement;
- description and category;
- amount and ISO currency;
- due date;
- payment state (`planned`, `due`, `part_paid`, `paid`, `cancelled`);
- paid date;
- operational note; and
- creator/update audit fields.

These fields describe what the wedding owes or has paid. They contain no family payer, contribution, allocation, or settlement information. Event-manager CRUD is performed through narrow RPCs that accept only operational fields.

### Private family-finance domain

The existing `finance_expense`, `finance_expense_allocation`, and `finance_net_position` structures become the private settlement domain. They retain payer-family and responsible-family information and are no longer readable merely because an account is `wedding_owner` or `event_manager`.

Existing expense rows are migrated one-to-one into `finance_cost_item` and linked through `finance_expense.cost_item_id`. This preserves current data while separating operational facts from private family attribution. New cost items do not require an immediate family allocation; a finance administrator can add the private settlement later.

### Published funding signal

`finance_funding_signal` contains one row per `(wedding_id, currency_code)`:

- `status` (`not_assessed`, `funded`, `funds_needed`);
- `updated_at`; and
- `updated_by_account_id` for private audit use.

The manager-facing view exposes only wedding, currency, status, and update time. The updating account is not exposed to the event manager.

The signal is manually published. It is deliberately not recalculated from contributions or cost totals. Automatic recalculation would allow a manager who can edit cost items to infer a private balance by changing amounts and observing when the signal flips.

## 4. Authorization contract

| Capability | Super-admin, normal mode | Wedding owner | Event manager | Finance admin | Host-group admin |
|---|---:|---:|---:|---:|---:|
| Configure wedding and roles | Yes | Yes | No | No | No |
| Manage operational costs | Only through assigned wedding role | No automatic access | Yes | Yes | No |
| See operational cost amounts | Only through assigned wedding role | No automatic access | Yes | Yes | No |
| See per-currency funding status | Only through assigned wedding role | Yes | Yes | Yes | Yes |
| See contribution amounts/identities | No automatic access | No automatic access | Never | Yes | Own side only when contribution module ships |
| See payer-family and allocation splits | No automatic access | No automatic access | Never | Yes | Own side under existing scope |
| Publish funding status | No automatic access | No | No | Yes | Only if also finance admin |
| Break-glass private access | Logged service workflow | No | No | Not applicable | No |

RLS and grants enforce the table rows. Restricted RPC signatures enforce writable columns. The UI reflects those permissions but is not a security boundary.

## 5. Application behavior

### Event-manager finance screen

The event-manager screen shows:

- wedding cost totals separated by currency;
- operational expense/vendor rows;
- due and overdue items;
- payment state;
- `Funded`, `Funds needed`, or `Not assessed` for each currency; and
- when each signal was last updated.

It does not render family names in a financial context, contributions, payer groups, allocation controls, or net settlement positions.

### Private finance screen

Finance administrators receive a separate private screen containing payer attribution, family allocation, settlement and funding controls. Publishing a signal requires an explicit confirmation because the result becomes visible to the event manager.

### Navigation

- `event_manager` sees “Finance operations.”
- `finance_admin` sees “Private finance.”
- An account with both roles sees both as distinct destinations.
- The existing owner label is changed from “Event manager” to “Wedding administrator.”

## 6. Audit and failure behavior

- Operational cost changes record actor, timestamp, cost item and changed operational fields.
- Funding-signal changes record the finance administrator and old/new state in the private audit trail.
- Event-manager audit output never contains contribution, balance, payer-family, allocation, or settlement values.
- Missing finance-admin authority fails closed with `42501`.
- Missing currency status renders `Not assessed`; it never guesses `Funded`.
- Currency totals are never combined through an implicit exchange rate.
- Direct calls to private tables, views, helper functions, and definer functions by an event manager are denied.

## 7. Migration and rollout

1. Add account-level platform-role storage and provision the existing account resolved from `jagrutpatel@gmail.com` as the initial super-admin.
2. Add `event_manager` and `finance_admin` wedding roles without changing existing assignments automatically.
3. Add `finance_cost_item` and `finance_funding_signal` with deny-by-default RLS and narrow grants.
4. Link existing private expense rows to migrated operational cost rows.
5. Replace finance authorization helpers so `wedding_owner` and `event_manager` cannot read private finance by implication.
6. Add manager-safe operational RPCs and finance-admin-only private/status RPCs.
7. Split the navigation and finance screens.
8. Explicitly assign pilot users to their intended roles. The platform super-admin account is also assigned the pilot roles needed for testing, but platform privilege itself does not bypass RLS.
9. Run adversarial tests and production migration before enabling the new navigation.

No existing private finance row is deleted. The release is database-first so the old application remains compatible while the new UI deploys.

## 8. Required tests

Database tests must prove:

- an event manager can create, edit and mark an operational cost paid;
- an event manager sees exact operational costs and per-currency status;
- an event manager receives zero private expense-allocation, payer-family, contribution and net-position rows;
- an event manager cannot execute private finance RPCs or status-publishing RPCs directly;
- changing an operational cost never changes the published funding signal;
- a finance administrator can see private data and publish a signal;
- a wedding owner without `finance_admin` cannot see private finance;
- a host-group admin remains isolated to its own side;
- USD and INR signals remain separate;
- an unrelated wedding cannot read either operational or private data; and
- platform super-admin status alone does not bypass wedding RLS.

Application tests must prove role-specific navigation, absence of family finance fields in the manager payload, per-currency status rendering, and failure-safe handling of `not_assessed`.

## 9. Alternatives rejected

### Hide private columns only in the React page

Rejected because the current owner policies and base-table grants would still expose the data through direct API calls.

### Keep `wedding_owner` synonymous with event manager

Rejected because wedding configuration authority, operational event management and private financial trust are separate responsibilities.

### Derive the status automatically from private balances

Rejected for the pilot because manager-controlled expenses would create a balance-inference channel. A later private recommendation engine may suggest a status to the finance administrator, but only the administrator's explicitly published state is exposed.

## 10. Success criteria

The design is complete when an event manager can run day-to-day wedding finance operations while every direct and indirect route to family contribution, balance, payer and allocation data is denied, and the only funding information available to that manager is a manually published per-currency status.
