type ProvisionAction = (formData: FormData) => void | Promise<void>;

export function PlatformProvisioningView({ action }: { action?: ProvisionAction }) {
  return (
    <section className="sg-section">
      <h2>Wedding creator access</h2>
      <p className="sg-muted">
        This account-level permission controls who may create new client weddings. It does not grant a role in any
        existing wedding.
      </p>
      <form action={action} className="sg-formrow">
        <label className="sg-field">
          <span className="sg-label">Planner email</span>
          <input className="sg-input" type="email" name="email" required placeholder="planner@example.com" />
        </label>
        <label className="sg-field">
          <span className="sg-label">{PLATFORM_CREATOR_LABEL}</span>
          <select className="sg-select" name="enabled" defaultValue="true">
            {CREATOR_ACCESS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="sg-field">
          <span className="sg-label">&nbsp;</span>
          <button className="sg-btn sg-btn--primary" type="submit">Save access</button>
        </div>
      </form>
    </section>
  );
}
import { CREATOR_ACCESS_OPTIONS, PLATFORM_CREATOR_LABEL } from '@/lib/data/platform';
