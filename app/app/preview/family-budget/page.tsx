import { notFound } from 'next/navigation';
import { FamilyBudgetWeddingView } from '../../host/budget/FamilyBudgetView';
import { HostNavView } from '../../host/HostNav';
import type { FamilyBudgetWedding } from '@/lib/data/family-finance';

// DEV-ONLY UI preview (no auth, no DB). Gated by PREVIEW_FIXTURES=1 so it 404s in prod.
export const dynamic = 'force-dynamic';

const FAMILY_SECTIONS = [
  { href: '/host/manage', label: 'Guests', key: 'manage' },
  { href: '/host/events', label: 'Events', key: 'events' },
  { href: '/host/stay-overview', label: 'Stay & travel', key: 'stay-overview' },
  { href: '/host/budget', label: 'Finance & vendors', key: 'budget' },
];

const FIX: FamilyBudgetWedding = {
  weddingId: 'w1', title: 'Patel · Shah', adminGroupId: 'bg1', adminGroupName: 'Shah family (bride)',
  net: [
    { groupName: 'Shah family (bride)', currency: 'INR', paid: 100000, allocated: 60000, net: 40000, mine: true },
    { groupName: 'Patel family (groom)', currency: 'INR', paid: 0, allocated: 40000, net: -40000, mine: false },
  ],
  expenses: [
    { id: 'x1', description: 'Décor advance', category: 'decor', amount: 100000, currency: 'INR', paidAt: '2026-08-01', paidByName: 'Shah family (bride)', note: 'Mandap + stage' },
  ],
  vendors: [
    { id: 'v1', name: 'Bloom & Petal Décor', category: 'decor', contactName: 'Rina', phone: '+91 98765 43210', email: 'hello@bloom.in', engagements: [{ roleTitle: 'Mandap décor', state: 'confirmed', quoteAmount: 100000, quoteCurrency: 'INR', eventName: 'Wedding ceremony' }] },
    { id: 'v2', name: 'DJ Aarav', category: 'dj', contactName: null, phone: '+91 90000 11111', email: null, engagements: [{ roleTitle: 'Sangeet DJ', state: 'quoted', quoteAmount: 45000, quoteCurrency: 'INR', eventName: 'Sangeet' }] },
  ],
};

export default function PreviewFamilyBudget() {
  if (process.env.PREVIEW_FIXTURES !== '1') notFound();
  return (
    <main className="sg-host">
      <div className="sg-host-shell">
        <HostNavView current="budget" email="bride.admin@example.com" roleLabel="Family admin" sections={FAMILY_SECTIONS} />
        <FamilyBudgetWeddingView w={FIX} />
      </div>
    </main>
  );
}
