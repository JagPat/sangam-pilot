# Sangam Wedding Cost Control Design

**Date:** 2026-07-28  
**Status:** Approved product direction; written specification awaiting final review  
**Scope:** Replace the current funding/private-finance model with official wedding cost planning, approval, commitment, invoice, and payment-status control.

## 1. Product boundary

Sangam records the wedding's official cost decisions. It does not record the families' finances.

The application may store monetary figures that belong to a wedding service or vendor transaction:

- an event manager's estimate;
- an approved estimate;
- an accepted quotation or contracted cost;
- an official invoice;
- GST or another applicable tax;
- an official vendor payment and its status; and
- the variance between those official figures.

The application must not store or infer:

- family contributions or contributor identities;
- bride-family versus groom-family funding allocations;
- family balances, bank accounts, statements, or available funds;
- personal affordability or wealth;
- money assigned to the event manager;
- private settlement positions or "who owes whom"; or
- `funded` / `funds_needed` signals.

The bride and groom are one wedding client in Cost Control. `host_group` must not be used to attribute costs, payments, approvals, or funding to either family.

## 2. Terminology and roles

The product and navigation label is **Cost Control**, not Finance.

### Event manager

The existing `event_manager` role is the planner role. It may:

- create and revise estimates;
- submit estimates for approval;
- record scope, exclusions, quantity, unit, rate, tax, suggested vendor, alternatives, potential savings, dependencies, and decision deadlines;
- see all official operational cost figures for the wedding;
- record proposed commitments and invoice/payment information; and
- respond to revision requests.

It may not approve or reject its own estimate and cannot change an approved estimate in place.

`event_manager` remains a wedding-scoped role. Separately, an account-level wedding-creator capability allows an approved planner to create a new client wedding. A planner account is not identified by a person's name or email in code.

When an approved planner creates a wedding, the atomic creation command assigns that account both:

- `wedding_owner`, for setup and wedding administration; and
- `event_manager`, for operational and Cost Control work.

An event manager invited to an existing wedding does not automatically receive permission to create unrelated weddings. A platform super-administrator must separately grant the account-level creator capability. The UI must show the creation form only when that capability is present.

### Cost approver

`cost_approver` replaces the product meaning of `finance_admin`. It may:

- approve, reject, or request revision of submitted estimates;
- approve proposed vendor commitments and material changes;
- record an official estimate directly, with an explicit `approver_entry` origin and audit event;
- see the consolidated Cost Control dashboard; and
- correct official invoice and payment records with an audit reason.

The wedding administrator appoints one or more cost approvers for each wedding. Pilot names and email addresses belong in deployment configuration or seed data, never in reusable schema, policies, application copy, or authorization logic. Role assignment uses immutable account IDs after invitation acceptance; email is only a provisioning lookup.

### Wedding administrator

`wedding_owner` continues to configure the wedding and assign roles. It does not receive cost-approval authority by implication.

### Family and guest roles

`host_group_admin`, `co_host`, and guests have no Cost Control access in the first release. Later, a specific decision may be shared with an invited family reviewer, but no general family-finance dashboard returns.

## 3. Cost lifecycle

An item moves through an explicit official-cost lifecycle:

1. **Draft estimate** — editable proposal, not part of official totals.
2. **Submitted estimate** — frozen version awaiting review.
3. **Under review** — an approver has opened the decision.
4. **Revision required** — returned with a required explanation.
5. **Rejected** — retained in history but excluded from official totals.
6. **Approved estimate** — the official planning baseline.
7. **Committed cost** — accepted quotation or contract.
8. **Final invoiced cost** — official invoice total.
9. **Paid/closed** — invoice payment status is complete.

Approval never overwrites an earlier amount. Revisions create a new immutable estimate version. Only one version may be the current approved baseline for a cost item.

An event manager cannot approve a proposal they submitted, even if that account also has another operational role. An approver may create a direct official entry for exceptional cases, but the application labels and audits that path rather than pretending it was independently reviewed.

## 4. Cost hierarchy

The hierarchy is:

`Cost centre -> Sub-centre -> Event (optional) -> Cost item`

Examples:

- `Decor -> Floral -> Sangeet -> Stage floral installation`
- `Hospitality -> Guest hampers -> All events -> Room hamper`

Cost centres are wedding-scoped and may have one parent. Event assignment points to `SubEventInstance`, because cost belongs to the actual dated occurrence, not the reusable `SubEvent` definition. A cost may be wedding-wide and therefore have no event instance.

The pilot template contains:

- venue and room inventory;
- food and beverages;
- alcohol;
- decor and flowers;
- sound, lighting, AV, and production;
- artists and entertainment;
- photography and films;
- makeup and styling;
- invitations and stationery;
- hampers and gifts;
- guest hospitality;
- airport and local transport;
- vendor travel, rooms, and meals;
- permissions and licences;
- rituals and ceremonial requirements;
- event-management fee;
- taxes; and
- contingency as a cost category, not a private fund balance.

`Miscellaneous` is allowed only with a required explanation. The interface warns when it exceeds a wedding-configured review threshold; the pilot does not hard-block it.

## 5. Data model

### `cost_centre`

- `id`, `wedding_id`
- `parent_id` with same-wedding composite foreign key
- stable `template_key`, display `name`, `sort_order`
- `active`, timestamps
- unique active name under the same parent

There is no budget-ceiling or funding-allocation column.

### `cost_item`

- `id`, `wedding_id`, `cost_centre_id`
- optional `event_instance_id` and `engagement_id`
- `title`, operational description
- lifecycle state (`planning`, `approved`, `committed`, `invoiced`, `closed`, `cancelled`)
- decision owner and decision deadline
- timestamps and actor IDs

Composite foreign keys enforce that centre, event instance, engagement, and cost item belong to the same wedding.

### `cost_estimate_version`

- `id`, `wedding_id`, `cost_item_id`, monotonically increasing `version_number`
- `origin` (`event_manager_submission`, `approver_entry`, `import`, `legacy_import`)
- scope included and excluded
- quantity, unit, unit rate
- subtotal, tax rate/amount, and total
- ISO currency code
- suggested vendor engagement
- alternative and saving proposal
- dependency, remarks, decision deadline
- state (`draft`, `submitted`, `under_review`, `revision_required`, `rejected`, `approved`, `superseded`)
- `created_by`, `submitted_by`, and timestamps

The database calculates or validates totals; a browser cannot submit inconsistent subtotal, tax, and total values. Currencies are never combined without a separately approved exchange-rate feature, which is outside this release.

### `cost_decision`

- estimate version and cost item
- decision (`review_started`, `approved`, `revision_required`, `rejected`, `approval_withdrawn`)
- required reason for every outcome except `review_started`
- actor and timestamp
- previous and resulting states

Rows are append-only. They are the decision history, not a mutable comment field.

### `cost_commitment`

- cost item and approved estimate version
- vendor engagement
- quotation/contract reference
- subtotal, tax, total, currency
- commitment date and actor
- state (`proposed`, `approved`, `cancelled`, `superseded`)
- reason for variance from the approved estimate

An event manager may propose a commitment. A cost approver approves it. The committed total is derived from the current approved commitment, not copied into `cost_item`.

### `cost_invoice`

- cost item and optional commitment
- vendor invoice reference and date
- subtotal, tax, total, currency
- due date
- state (`received`, `verified`, `disputed`, `part_paid`, `paid`, `void`)
- verified/updated actor and audit reason

### `cost_payment`

- invoice, official payment amount/date/reference
- payment method category only (for example `bank_transfer`, `card`, `cash`, `other`)
- recording actor and timestamp

No bank account, card number, payer-family, contributor, or source-of-funds field exists. The paid and outstanding amounts are derived from invoices and their official payment records.

### Derived views

Security-invoker views provide per-wedding and per-currency:

- submitted estimate total;
- approved estimate total;
- approved commitment total;
- verified invoice total;
- recorded paid total;
- outstanding invoice total;
- variance from approved estimate;
- decisions awaiting action; and
- payments due within 15 days.

All totals remain separate by currency.

## 6. Authorization and mutation rules

- Base tables use deny-by-default RLS and narrow table grants.
- Authenticated mutations use RPCs whose actor is derived from the verified Supabase session.
- Wedding ID, role, and actor are never accepted as authorization facts from the browser.
- Event managers can mutate only draft/revision proposal fields and propose commitments/invoices.
- Cost approvers decide submitted estimates and commitments.
- Submitted, approved, rejected, committed, and invoiced records cannot be edited in place.
- Direct DML cannot bypass the state machine.
- Cross-wedding composite constraints prevent IDs from being mixed across tenants.
- Definer functions revoke execution from `PUBLIC` and receive explicit role grants.
- Aggregate views use invoker security and are tested against unrelated authenticated accounts.
- Service-role imports set `origin='import'` and retain the importing account/job in audit metadata.

## 7. Application experience

### Cost Control dashboard

The dashboard answers:

1. What estimates are waiting for a decision?
2. What is the approved estimate total?
3. What has been officially committed?
4. What has been invoiced and recorded as paid?
5. What official payments are due soon?
6. Which items vary most from their approved estimate?

It never shows funds available, family contributions, allocations, balances, or settlement.

### Event-manager workspace

An assigned event manager sees a hierarchy browser, filters by event/vendor/status, a structured estimate form, revision requests, commitment proposals, invoices, and upcoming payment requirements. The interface clearly distinguishes `Estimate`, `Approved estimate`, `Committed`, and `Final invoice` so one number cannot silently replace another.

### Approver workspace

Approvers receive a queue showing the submitted scope, current proposal, earlier versions, variance, alternatives, decision deadline, and decision history. Approval requires confirmation; revision and rejection require a reason.

## 8. Migration from the current application

The existing implementation has two domains: manager-facing `finance_cost_item` and private family tables (`finance_expense`, `finance_expense_allocation`, and `finance_net_position`) plus the funding signal.

Migration occurs in safe stages:

1. Correct planner onboarding: expose the existing account-level creator capability to platform administration, hide wedding creation from unprovisioned accounts, and assign both `wedding_owner` and `event_manager` when an approved planner creates a wedding.
2. Introduce `cost_approver` and migrate existing pilot `finance_admin` assignments after verifying intended users.
3. Create the new Cost Control tables, template, RPCs, RLS, and tests alongside the current operational table.
4. Convert each legitimate `finance_cost_item` into a `cost_item` plus an initial estimate/commitment/invoice record according to its current state. Mark the origin `legacy_import` in audit metadata.
5. Remove `finance_funding_status` from navigation and revoke all access to `finance_funding_signal` immediately.
6. Inventory private-table production rows. Preserve only official vendor facts by converting them into Cost Control records; do not copy payer-family or allocation data.
7. Produce an operator-reviewed migration report before deleting any source row.
8. Drop the private-finance screens, RPC execution grants, views, and tables after the report confirms the official records were preserved.
9. Rename `/host/costs` to the Cost Control experience and remove `/host/finance` and `/host/budget` financial views.

The migration must not silently delete production records, but its terminal state contains no family contribution, payer-family, allocation, balance, or settlement data.

## 9. First-release boundary

### MVP now

- cost-centre hierarchy and standard template;
- event/vendor association;
- immutable estimate versions;
- submit/review/approve/revise/reject workflow;
- approved commitments;
- invoice and payment status;
- GST-aware official totals;
- variance and upcoming-decision dashboard;
- append-only decision/audit history;
- role-specific UI and adversarial RLS tests; and
- removal of funding/private-finance application access.

### Fast follow

- multiple quote comparison;
- document attachments and retention policy;
- Excel import with preview, validation, and reconciliation;
- configurable approval thresholds;
- selected family-review invitations; and
- vendor portal.

Custom multi-level approval chains, exchange-rate consolidation, purchase orders, accounting exports, and bank integrations are explicitly later.

## 10. Required tests

Database and real-auth tests must prove:

- an event manager can draft, revise, and submit an estimate;
- an unprovisioned authenticated account cannot create a wedding and is not shown a misleading creation form;
- a platform-approved planner can create a wedding and atomically receives `wedding_owner` plus `event_manager` for it;
- an event manager for one wedding cannot create another wedding unless separately granted the account-level creator capability;
- an event manager cannot approve/reject any estimate or mutate a submitted version;
- a submitter cannot approve their own submission;
- a cost approver can decide a submitted estimate and the decision is append-only;
- only one approved estimate and one approved commitment are current per cost item;
- totals and GST cannot be forged through inconsistent inputs;
- cross-wedding centre, event, engagement, estimate, commitment, invoice, and payment IDs are rejected;
- unauthorised family users and unrelated authenticated users see zero Cost Control rows;
- aggregate views do not bypass RLS;
- no authenticated actor can call ungranted definer helpers;
- the manager-visible payload contains no host-group, funding, contribution, allocation, balance, or settlement fields;
- payment records contain no personal financial instrument or source-of-funds data; and
- the legacy private-finance surfaces and funding signal are inaccessible before Cost Control is enabled in production.

Application tests must cover role-specific navigation, workflow transitions, duplicate submissions, stale-version decisions, currency separation, empty/error states, and accessible approval confirmation.

## 11. Release gates

The feature is not production-ready until:

- migrations and adversarial SQL suites pass against `supabase start` with real `anon`, `authenticated`, `service_role`, and `auth` schemas;
- `npm ci`, typecheck, unit/integration tests, and the production build pass;
- the private-data inventory and official-record conversion report are reviewed;
- live tests confirm an assigned event manager can submit but not approve, an assigned approver can decide, and unrelated users receive no rows;
- the live UI contains no funding or family-finance language; and
- rollback preserves the new official records without restoring private-finance exposure.

## 12. Success criteria

Sangam succeeds when any assigned event manager can estimate and manage the official costs for their wedding, the designated approvers can approve and audit those decisions, and no part of the application records or exposes how either family funds the wedding.
