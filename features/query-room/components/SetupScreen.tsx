import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { type CheckState, type ModelForm, type SetupForm, type Theme } from '../types';
import ThemeToggle from './ThemeToggle';

export default function SetupScreen(props: {
  theme: Theme;
  toggleTheme: () => void;
  setup: SetupForm;
  setSetup: Dispatch<SetStateAction<SetupForm>>;
  model: ModelForm;
  setModel: Dispatch<SetStateAction<ModelForm>>;
  dbAdvanced: boolean;
  setDbAdvanced: (value: boolean) => void;
  modelAdvanced: boolean;
  setModelAdvanced: (value: boolean) => void;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  showApiKey: boolean;
  setShowApiKey: (value: boolean) => void;
  passphrase: string;
  setPassphrase: (value: string) => void;
  dbCheck: { state: CheckState; message?: string; details?: string };
  modelCheck: { state: CheckState; message?: string; details?: string };
  setDbCheck: Dispatch<SetStateAction<{ state: CheckState; message?: string; details?: string }>>;
  setModelCheck: Dispatch<
    SetStateAction<{ state: CheckState; message?: string; details?: string }>
  >;
  testDatabase: () => void;
  testModel: () => void;
  resetDatabaseForm: () => void;
  resetModelForm: () => void;
  saveWorkspace: () => void;
}) {
  const { setup, setSetup, model, setModel } = props;
  const set = (key: keyof SetupForm, value: string | boolean) =>
    setSetup(current => ({ ...current, [key]: value }));
  const setModelValue = (key: keyof ModelForm, value: string) =>
    setModel(current => ({ ...current, [key]: value }));
  const setDatabaseValue = (key: keyof SetupForm, value: string | boolean) => {
    set(key, value);
    props.setDbCheck({ state: 'idle' });
  };
  const setModelField = (key: keyof ModelForm, value: string) => {
    setModelValue(key, value);
    props.setModelCheck({ state: 'idle' });
  };
  const dialects = [
    { value: 'postgresql', label: 'PostgreSQL', note: 'Default', icon: '◉' },
    { value: 'mysql', label: 'MySQL', note: 'Reliable', icon: '◈' },
    { value: 'sqlite', label: 'SQLite', note: 'Local file', icon: '▣' },
  ] as const;
  return (
    <main className='setup-page'>
      <header className='topbar'>
        <div className='brand'>
          <div className='brand-mark'>
            <Sparkles size={18} />
          </div>
          <div>
            <span className='brand-name'>Queryroom</span>
            <span className='brand-subtitle'>Read-only data intelligence</span>
          </div>
        </div>
        <div className='topbar-actions'>
          <span className='status-pill'>
            <span className='status-dot' />
            Setup mode
          </span>
          <ThemeToggle theme={props.theme} toggle={props.toggleTheme} />
        </div>
      </header>
      <div className='setup-heading'>
        <div>
          <p className='eyebrow'>Workspace setup · 01</p>
          <h1>Connect your data room.</h1>
          <p className='lede'>
            Give your agent a safe, read-only view of a database. You stay in control of every
            query.
          </p>
        </div>
        <div className='setup-progress'>
          <span className='progress-active' />
          <span />
          <span />
        </div>
      </div>
      <div className='setup-grid'>
        <section className='setup-card'>
          <SectionTitle
            number='01'
            icon={<Database size={18} />}
            title='Database connection'
            subtitle='Where should Queryroom look for answers?'
          />
          <div className='form-grid'>
            <Field label='Profile name' hint='A friendly name for this connection' className='wide'>
              <input
                value={setup.name}
                onChange={event => setDatabaseValue('name', event.target.value)}
                placeholder='e.g. Production analytics'
              />
            </Field>
            <Field label='Description' hint='Optional notes about this database' className='wide'>
              <textarea
                value={setup.description}
                onChange={event => setDatabaseValue('description', event.target.value)}
                placeholder='What kind of data lives here?'
                rows={2}
              />
            </Field>
          </div>
          <label className='field-label'>Database type</label>
          <div className='dialect-grid'>
            {dialects.map(dialect => (
              <button
                key={dialect.value}
                className={`dialect-card ${setup.dialect === dialect.value ? 'selected' : ''}`}
                onClick={() => {
                  setDatabaseValue('dialect', dialect.value);
                  setDatabaseValue('port', dialect.value === 'postgresql' ? '5432' : '3306');
                }}
              >
                <span className='dialect-icon'>{dialect.icon}</span>
                <span className='dialect-label'>{dialect.label}</span>
                <span className='dialect-note'>{dialect.note}</span>
                {setup.dialect === dialect.value && <Check className='dialect-check' size={16} />}
              </button>
            ))}
          </div>
          {setup.dialect === 'sqlite' ? (
            <div className='form-grid'>
              <Field
                label='Database file path'
                hint='The path must be visible to the Node server'
                className='wide'
              >
                <div className='input-wrap'>
                  <Terminal size={16} />
                  <input
                    value={setup.path}
                    onChange={event => setDatabaseValue('path', event.target.value)}
                    placeholder='/var/data/analytics.sqlite'
                  />
                </div>
              </Field>
              <div className='readonly-callout'>
                <ShieldCheck size={17} />
                <div>
                  <strong>Read-only is always on</strong>
                  <span>SQLite writes are disabled at the driver level.</span>
                </div>
              </div>
            </div>
          ) : (
            <div className='form-grid'>
              <Field label='Host' required>
                <input
                  value={setup.host}
                  onChange={event => setDatabaseValue('host', event.target.value)}
                  placeholder='localhost or 192.168.1.100'
                />
              </Field>
              <Field label='Port' required>
                <input
                  value={setup.port}
                  onChange={event => setDatabaseValue('port', event.target.value)}
                  inputMode='numeric'
                />
              </Field>
              <Field label='Database name' required>
                <input
                  value={setup.database}
                  onChange={event => setDatabaseValue('database', event.target.value)}
                  placeholder='analytics'
                />
              </Field>
              <Field label='Username' required>
                <input
                  value={setup.username}
                  onChange={event => setDatabaseValue('username', event.target.value)}
                  placeholder='readonly_user'
                />
              </Field>
              <Field label='Password' required>
                <div className='input-wrap'>
                  <KeyRound size={16} />
                  <input
                    type={props.showPassword ? 'text' : 'password'}
                    value={setup.password}
                    onChange={event => setDatabaseValue('password', event.target.value)}
                    placeholder='Database password'
                  />
                  <button
                    className='icon-button'
                    onClick={() => props.setShowPassword(!props.showPassword)}
                    aria-label={props.showPassword ? 'Hide password' : 'Show password'}
                  >
                    {props.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
              <label className='switch-row'>
                <input
                  type='checkbox'
                  checked={setup.ssl}
                  onChange={event => setDatabaseValue('ssl', event.target.checked)}
                />
                <span className='switch' />
                <span>
                  <strong>Use SSL</strong>
                  <small>Require an encrypted connection</small>
                </span>
              </label>
            </div>
          )}
          <button
            className='advanced-toggle'
            onClick={() => props.setDbAdvanced(!props.dbAdvanced)}
          >
            <span>
              <ChevronDown size={16} className={props.dbAdvanced ? 'rotate' : ''} />
              Advanced safety limits
            </span>
            <small>Allowlist, timeout, row and response caps</small>
          </button>
          {props.dbAdvanced && (
            <div className='advanced-panel'>
              <Field
                label='Allowed tables or schemas'
                hint='Comma-separated; leave blank to use discovered schema'
                className='wide'
              >
                <input
                  value={setup.allowedObjects}
                  onChange={event => setDatabaseValue('allowedObjects', event.target.value)}
                  placeholder='public.customers, public.orders'
                />
              </Field>
              <div className='form-grid'>
                <Field label='Query timeout (ms)'>
                  <input
                    value={setup.timeoutMs}
                    onChange={event => setDatabaseValue('timeoutMs', event.target.value)}
                    inputMode='numeric'
                  />
                </Field>
                <Field label='Maximum rows'>
                  <input
                    value={setup.maxRows}
                    onChange={event => setDatabaseValue('maxRows', event.target.value)}
                    inputMode='numeric'
                  />
                </Field>
                <Field label='Maximum response bytes'>
                  <input
                    value={setup.maxResponseBytes}
                    onChange={event => setDatabaseValue('maxResponseBytes', event.target.value)}
                    inputMode='numeric'
                  />
                </Field>
              </div>
            </div>
          )}
          <div className='test-row'>
            <TestStatus {...props.dbCheck} />
            <div className='test-actions'>
              <button
                className='ghost-button reset-form-button'
                onClick={props.resetDatabaseForm}
                disabled={props.dbCheck.state === 'testing'}
              >
                <RefreshCw size={15} />
                Reset form
              </button>
              <button
                className='outline-button'
                onClick={props.testDatabase}
                disabled={props.dbCheck.state === 'testing'}
              >
                {props.dbCheck.state === 'testing' ? (
                  <RefreshCw className='spin' size={16} />
                ) : (
                  <Zap size={16} />
                )}
                Test database connection
              </button>
            </div>
          </div>
        </section>
        <section className='setup-card'>
          <SectionTitle
            number='02'
            icon={<Sparkles size={18} />}
            title='Model connection'
            subtitle='The reasoning layer behind your data room.'
          />
          <div className='provider-card selected'>
            <span className='provider-logo'>◎</span>
            <div>
              <strong>OpenAI</strong>
              <small>Use an OpenAI-compatible chat model</small>
            </div>
            <Check size={16} className='provider-check' />
          </div>
          <div className='form-grid'>
            <Field label='Model' required className='wide'>
              <input
                value={model.model}
                onChange={event => setModelField('model', event.target.value)}
                placeholder='Enter a model identifier'
              />
            </Field>
            <Field label='API key' required className='wide'>
              <div className='input-wrap'>
                <KeyRound size={16} />
                <input
                  type={props.showApiKey ? 'text' : 'password'}
                  value={model.apiKey}
                  onChange={event => setModelField('apiKey', event.target.value)}
                  placeholder='sk-…'
                />
                <button
                  className='icon-button'
                  onClick={() => props.setShowApiKey(!props.showApiKey)}
                  aria-label={props.showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {props.showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          </div>
          <button
            className='advanced-toggle'
            onClick={() => props.setModelAdvanced(!props.modelAdvanced)}
          >
            <span>
              <ChevronDown size={16} className={props.modelAdvanced ? 'rotate' : ''} />
              Advanced model settings
            </span>
            <small>Base URL and temperature</small>
          </button>
          {props.modelAdvanced && (
            <div className='advanced-panel'>
              <div className='form-grid'>
                <Field label='Base URL' hint='Optional OpenAI-compatible endpoint' className='wide'>
                  <input
                    value={model.baseUrl}
                    onChange={event => setModelField('baseUrl', event.target.value)}
                    placeholder='https://api.openai.com/v1'
                  />
                </Field>
                <Field label='Temperature'>
                  <input
                    value={model.temperature}
                    onChange={event => setModelField('temperature', event.target.value)}
                    inputMode='decimal'
                  />
                </Field>
              </div>
            </div>
          )}
          <div className='test-row'>
            <TestStatus {...props.modelCheck} />
            <div className='test-actions'>
              <button
                className='ghost-button reset-form-button'
                onClick={props.resetModelForm}
                disabled={props.modelCheck.state === 'testing'}
              >
                <RefreshCw size={15} />
                Reset form
              </button>
              <button
                className='outline-button'
                onClick={props.testModel}
                disabled={props.modelCheck.state === 'testing'}
              >
                {props.modelCheck.state === 'testing' ? (
                  <RefreshCw className='spin' size={16} />
                ) : (
                  <Zap size={16} />
                )}
                Test model connection
              </button>
            </div>
          </div>
        </section>
        <section className='setup-card security-card'>
          <SectionTitle
            number='03'
            icon={<Lock size={18} />}
            title='Protect this workspace'
            subtitle='Your profiles stay in your browser, encrypted.'
          />
          <div className='security-copy'>
            <ShieldCheck size={20} />
            <div>
              <strong>Local encrypted vault</strong>
              <p>
                Credentials are encrypted with your passphrase before they are saved. The unlocked
                values are kept in memory only.
              </p>
            </div>
          </div>
          <Field
            label='Vault passphrase'
            required
            hint='You will need this to unlock the workspace on your next visit'
            className='wide'
          >
            <input
              type='password'
              value={props.passphrase}
              onChange={event => props.setPassphrase(event.target.value)}
              placeholder='Create a strong passphrase'
            />
          </Field>
          <div className='save-row'>
            <div>
              <span className='save-check'>
                <Check size={14} />
              </span>
              <span>Approval required before every query</span>
            </div>
            <button
              className='primary-button'
              onClick={props.saveWorkspace}
              disabled={
                !props.passphrase ||
                props.dbCheck.state !== 'success' ||
                props.modelCheck.state !== 'success'
              }
            >
              Save and open workspace
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </div>
      <footer className='page-footer'>
        <span>
          <Lock size={13} />
          Database credentials never enter model prompts
        </span>
        <span>
          <ShieldCheck size={13} />
          Read-only execution by design
        </span>
      </footer>
    </main>
  );
}

function SectionTitle({
  number,
  icon,
  title,
  subtitle,
}: {
  number: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className='section-title'>
      <span className='section-number'>{number}</span>
      <span className='section-icon'>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field ${className}`}>
      <span className='field-label'>
        {label}
        {required && <em>*</em>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function TestStatus({
  state,
  message,
  details,
}: {
  state: CheckState;
  message?: string;
  details?: string;
}) {
  if (state === 'idle')
    return (
      <span className='test-help'>
        <Zap size={14} />
        Run a test before saving
      </span>
    );
  if (state === 'testing')
    return (
      <span className='test-status testing'>
        <RefreshCw className='spin' size={14} />
        Testing connection
      </span>
    );
  if (state === 'success')
    return (
      <span className='test-status success'>
        <CircleCheck size={15} />
        <span>
          <strong>{message}</strong>
          <small>{details}</small>
        </span>
      </span>
    );
  return (
    <span className='test-status error' role='alert'>
      <CircleAlert size={15} />
      <span>
        <strong>{message}</strong>
        <small>Nothing was saved</small>
      </span>
    </span>
  );
}
