import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  LoaderCircle,
} from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { CheckState, ModelForm, SetupForm, Theme } from '../types';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';

type CheckResult = { state: CheckState; message?: string; details?: string };

const dialects = [
  { value: 'postgresql', label: 'PostgreSQL', port: '5432' },
  { value: 'mysql', label: 'MySQL', port: '3306' },
  { value: 'sqlite', label: 'SQLite', port: '' },
] as const;

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
  dbCheck: CheckResult;
  modelCheck: CheckResult;
  setDbCheck: Dispatch<SetStateAction<CheckResult>>;
  setModelCheck: Dispatch<SetStateAction<CheckResult>>;
  testDatabase: () => void;
  testModel: () => void;
  resetDatabaseForm: () => void;
  resetModelForm: () => void;
  saveWorkspace: () => void;
}) {
  const { setup, setSetup, model, setModel } = props;
  // Any edit invalidates the last connection test.
  const setDatabaseValue = (key: keyof SetupForm, value: string | boolean) => {
    setSetup(current => ({ ...current, [key]: value }));
    props.setDbCheck({ state: 'idle' });
  };
  const setModelField = (key: keyof ModelForm, value: string) => {
    setModel(current => ({ ...current, [key]: value }));
    props.setModelCheck({ state: 'idle' });
  };
  const dbReady = props.dbCheck.state === 'success';
  const modelReady = props.modelCheck.state === 'success';
  const canSave = dbReady && modelReady && props.passphrase.length > 0;

  return (
    <main className='setup'>
      <header className='setup-header'>
        <Logo />
        <ThemeToggle theme={props.theme} toggle={props.toggleTheme} />
      </header>

      <div className='setup-body'>
        <aside className='setup-intro'>
          <h1>Set up your workspace</h1>
          <p>
            Connect a database and a model. The agent drafts SQL for your questions, and nothing
            runs until you approve it in a read-only transaction.
          </p>
          <ol className='steps'>
            <Step index={1} done={dbReady} title='Database' detail={props.dbCheck.details} />
            <Step index={2} done={modelReady} title='Model' detail={props.modelCheck.details} />
            <Step
              index={3}
              done={props.passphrase.length > 0}
              title='Passphrase'
              detail='Encrypts everything saved in this browser'
            />
          </ol>
        </aside>

        <div className='setup-forms'>
          <section className='panel' aria-labelledby='database-heading'>
            <div className='panel-header'>
              <h2 id='database-heading'>Database</h2>
              <p>Use a database user with read-only permissions.</p>
            </div>
            <div className='panel-body'>
              <div className='field-grid'>
                <Field label='Name' hint='Shown in the sidebar'>
                  <input
                    className='input'
                    value={setup.name}
                    onChange={event => setDatabaseValue('name', event.target.value)}
                    placeholder='Production analytics'
                  />
                </Field>
                <div className='field'>
                  <span className='field-label'>Type</span>
                  <div className='segmented' role='radiogroup' aria-label='Database type'>
                    {dialects.map(dialect => (
                      <button
                        key={dialect.value}
                        type='button'
                        role='radio'
                        aria-checked={setup.dialect === dialect.value}
                        onClick={() => {
                          setDatabaseValue('dialect', dialect.value);
                          if (dialect.port) setDatabaseValue('port', dialect.port);
                        }}
                      >
                        {dialect.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Field
                  label='Description'
                  hint='Optional. Given to the model as context, e.g. what the tables contain.'
                  className='span-2'
                >
                  <textarea
                    className='input'
                    value={setup.description}
                    onChange={event => setDatabaseValue('description', event.target.value)}
                    placeholder='Orders and customers for the EU storefront. Amounts are in cents.'
                    rows={2}
                  />
                </Field>
              </div>

              {setup.dialect === 'sqlite' ? (
                <Field label='File path' hint='Must be readable by the server'>
                  <input
                    className='input'
                    value={setup.path}
                    onChange={event => setDatabaseValue('path', event.target.value)}
                    placeholder='/var/data/analytics.sqlite'
                    spellCheck={false}
                  />
                </Field>
              ) : (
                <div className='field-grid'>
                  <Field label='Host'>
                    <input
                      className='input'
                      value={setup.host}
                      onChange={event => setDatabaseValue('host', event.target.value)}
                      placeholder='localhost'
                      spellCheck={false}
                    />
                  </Field>
                  <Field label='Port'>
                    <input
                      className='input'
                      value={setup.port}
                      onChange={event => setDatabaseValue('port', event.target.value)}
                      inputMode='numeric'
                    />
                  </Field>
                  <Field label='Database'>
                    <input
                      className='input'
                      value={setup.database}
                      onChange={event => setDatabaseValue('database', event.target.value)}
                      placeholder='analytics'
                      spellCheck={false}
                    />
                  </Field>
                  <Field label='Username'>
                    <input
                      className='input'
                      value={setup.username}
                      onChange={event => setDatabaseValue('username', event.target.value)}
                      placeholder='readonly_user'
                      spellCheck={false}
                      autoComplete='off'
                    />
                  </Field>
                  <Field label='Password'>
                    <SecretInput
                      value={setup.password}
                      onChange={value => setDatabaseValue('password', value)}
                      visible={props.showPassword}
                      setVisible={props.setShowPassword}
                      placeholder='Database password'
                      name='password'
                    />
                  </Field>
                  <label className='switch switch-cell'>
                    <input
                      type='checkbox'
                      checked={setup.ssl}
                      onChange={event => setDatabaseValue('ssl', event.target.checked)}
                    />
                    <span className='switch-copy'>
                      <span className='field-label'>Use SSL</span>
                    </span>
                  </label>
                </div>
              )}

              <Disclosure
                open={props.dbAdvanced}
                setOpen={props.setDbAdvanced}
                label='Safety limits'
              >
                <Field
                  label='Allowed tables'
                  hint='Comma-separated. Leave empty to allow every table the user can read.'
                >
                  <input
                    className='input'
                    value={setup.allowedObjects}
                    onChange={event => setDatabaseValue('allowedObjects', event.target.value)}
                    placeholder='public.customers, public.orders'
                    spellCheck={false}
                  />
                </Field>
                <div className='field-grid'>
                  <Field label='Query timeout (ms)'>
                    <input
                      className='input'
                      value={setup.timeoutMs}
                      onChange={event => setDatabaseValue('timeoutMs', event.target.value)}
                      inputMode='numeric'
                    />
                  </Field>
                  <Field label='Maximum rows'>
                    <input
                      className='input'
                      value={setup.maxRows}
                      onChange={event => setDatabaseValue('maxRows', event.target.value)}
                      inputMode='numeric'
                    />
                  </Field>
                  <Field label='Maximum response size (bytes)'>
                    <input
                      className='input'
                      value={setup.maxResponseBytes}
                      onChange={event => setDatabaseValue('maxResponseBytes', event.target.value)}
                      inputMode='numeric'
                    />
                  </Field>
                </div>
              </Disclosure>
            </div>
            <div className='panel-footer'>
              <TestStatus {...props.dbCheck} />
              <div className='panel-actions'>
                <button
                  className='btn btn-ghost'
                  onClick={props.resetDatabaseForm}
                  disabled={props.dbCheck.state === 'testing'}
                >
                  Reset
                </button>
                <button
                  className='btn btn-secondary'
                  onClick={props.testDatabase}
                  disabled={props.dbCheck.state === 'testing'}
                >
                  Test connection
                </button>
              </div>
            </div>
          </section>

          <section className='panel' aria-labelledby='model-heading'>
            <div className='panel-header'>
              <h2 id='model-heading'>Model</h2>
              <p>Any OpenAI-compatible chat model that supports tool calling.</p>
            </div>
            <div className='panel-body'>
              <div className='field-grid'>
                <Field label='Model'>
                  <input
                    className='input'
                    name='model'
                    value={model.model}
                    onChange={event => setModelField('model', event.target.value)}
                    placeholder='gpt-4o-mini'
                    spellCheck={false}
                  />
                </Field>
                <Field label='API key'>
                  <SecretInput
                    value={model.apiKey}
                    onChange={value => setModelField('apiKey', value)}
                    visible={props.showApiKey}
                    setVisible={props.setShowApiKey}
                    placeholder='sk-…'
                    name='apiKey'
                  />
                </Field>
              </div>
              <Disclosure
                open={props.modelAdvanced}
                setOpen={props.setModelAdvanced}
                label='Endpoint and temperature'
              >
                <div className='field-grid'>
                  <Field label='Base URL' hint='Leave empty for api.openai.com'>
                    <input
                      className='input'
                      value={model.baseUrl}
                      onChange={event => setModelField('baseUrl', event.target.value)}
                      placeholder='https://api.openai.com/v1'
                      spellCheck={false}
                    />
                  </Field>
                  <Field label='Temperature'>
                    <input
                      className='input'
                      value={model.temperature}
                      onChange={event => setModelField('temperature', event.target.value)}
                      inputMode='decimal'
                    />
                  </Field>
                </div>
              </Disclosure>
            </div>
            <div className='panel-footer'>
              <TestStatus {...props.modelCheck} />
              <div className='panel-actions'>
                <button
                  className='btn btn-ghost'
                  onClick={props.resetModelForm}
                  disabled={props.modelCheck.state === 'testing'}
                >
                  Reset
                </button>
                <button
                  className='btn btn-secondary'
                  onClick={props.testModel}
                  disabled={props.modelCheck.state === 'testing'}
                >
                  Test model
                </button>
              </div>
            </div>
          </section>

          <section className='panel' aria-labelledby='vault-heading'>
            <div className='panel-header'>
              <h2 id='vault-heading'>Passphrase</h2>
              <p>
                Credentials and chat history are encrypted with this passphrase and stored only in
                this browser. It can&apos;t be recovered.
              </p>
            </div>
            <div className='panel-body'>
              <Field label='Passphrase'>
                <input
                  className='input'
                  type='password'
                  value={props.passphrase}
                  onChange={event => props.setPassphrase(event.target.value)}
                  onKeyDown={event => event.key === 'Enter' && canSave && props.saveWorkspace()}
                  placeholder='Create a strong passphrase'
                  autoComplete='new-password'
                />
              </Field>
            </div>
            <div className='panel-footer'>
              <span className='status'>
                {canSave ? 'Ready to save.' : 'Test the database and model to continue.'}
              </span>
              <div className='panel-actions'>
                <button
                  className='btn btn-primary'
                  onClick={props.saveWorkspace}
                  disabled={!canSave}
                >
                  Save and open workspace
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Step({
  index,
  done,
  title,
  detail,
}: {
  index: number;
  done: boolean;
  title: string;
  detail?: string;
}) {
  return (
    <li data-done={done}>
      <span className='step-dot'>{done ? <Check size={12} strokeWidth={3} /> : index}</span>
      <span>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
    </li>
  );
}

function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field ${className}`}>
      <span className='field-label'>{label}</span>
      {children}
      {hint && <span className='field-hint'>{hint}</span>}
    </label>
  );
}

function SecretInput({
  value,
  onChange,
  visible,
  setVisible,
  placeholder,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  setVisible: (value: boolean) => void;
  placeholder: string;
  name: string;
}) {
  return (
    <span className='input-group'>
      <input
        name={name}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete='off'
        spellCheck={false}
      />
      <button
        type='button'
        className='icon-btn'
        onClick={() => setVisible(!visible)}
        aria-label={visible ? 'Hide value' : 'Show value'}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}

function Disclosure({
  open,
  setOpen,
  label,
  children,
}: {
  open: boolean;
  setOpen: (value: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <div>
        <button
          type='button'
          className='disclosure'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={15} />
          {label}
        </button>
      </div>
      {open && <div className='advanced'>{children}</div>}
    </>
  );
}

function TestStatus({ state, message, details }: CheckResult) {
  if (state === 'testing')
    return (
      <span className='status'>
        <LoaderCircle className='spin' size={14} />
        Testing…
      </span>
    );
  if (state === 'success')
    return (
      <span className='status success'>
        <CircleCheck size={14} />
        <span>
          <strong>{message}</strong>
          {details && <small>{details}</small>}
        </span>
      </span>
    );
  if (state === 'error')
    return (
      <span className='status error' role='alert'>
        <CircleAlert size={14} />
        <span>{message}</span>
      </span>
    );
  return <span className='status'>Not tested yet</span>;
}
