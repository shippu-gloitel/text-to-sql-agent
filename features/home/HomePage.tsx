'use client';

import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react';
import {
  ArrowRight,
  Check,
  Database,
  FileDown,
  Gauge,
  KeyRound,
  ListChecks,
  Lock,
  MessagesSquare,
  MessageSquareText,
  PencilLine,
  Plus,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  SquareTerminal,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import Logo from '@/features/shared/Logo';
import ThemeToggle from '@/features/shared/ThemeToggle';
import ProductDemo from './ProductDemo';

const EASE = [0.22, 1, 0.36, 1] as const;

const STEPS = [
  {
    title: 'Ask',
    text: 'Type a question or paste a SELECT. The agent reads your schema, including foreign keys, to understand how tables connect.',
  },
  {
    title: 'Draft and check',
    text: 'The model drafts one read-only query. A SQL parser checks it, and if it fails the model gets the errors and corrects it.',
  },
  {
    title: 'You approve',
    text: 'See the exact SQL and the tables it reads. Approve it, edit it yourself, or reject it. Edits are checked again.',
  },
  {
    title: 'Run read-only',
    text: 'The query runs in a read-only transaction with a timeout and row limit. Results come back as a table you can export.',
  },
];

const FEATURES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: MessageSquareText,
    title: 'Plain language to SQL',
    text: 'Ask the way you would ask a colleague. Works with any OpenAI-compatible chat model, hosted or on your own endpoint.',
  },
  {
    icon: ShieldCheck,
    title: 'Approval before every query',
    text: 'Nothing touches your database until you have read the SQL and pressed approve. Approvals are single-use.',
  },
  {
    icon: PencilLine,
    title: 'Edit before you run',
    text: 'Adjust the generated SQL inline. Your edits go through the same safety check before they can run.',
  },
  {
    icon: Lock,
    title: 'Read-only by design',
    text: 'Only a single SELECT or WITH passes. Writes, locks, comments and admin functions like pg_* or SLEEP are rejected.',
  },
  {
    icon: RotateCcw,
    title: 'Self-correcting drafts',
    text: 'When a draft fails the safety check, the model sees exactly why and gets two attempts to fix it.',
  },
  {
    icon: Gauge,
    title: 'Enforced limits',
    text: 'Every query gets an outer row limit, a statement timeout and a response-size cap that you configure.',
  },
  {
    icon: Database,
    title: 'PostgreSQL, MySQL, SQLite',
    text: 'Connect to PostgreSQL, MySQL or MariaDB, or a local SQLite file. Tables, columns and relationships are discovered automatically.',
  },
  {
    icon: ListChecks,
    title: 'Table allowlist',
    text: 'Limit the agent to the tables or schemas you choose. Everything else is hidden from the model and blocked.',
  },
  {
    icon: Zap,
    title: 'Instant catalog answers',
    text: 'Table lists and row counts come straight from database statistics, with no model call and no slow COUNT(*).',
  },
  {
    icon: SquareTerminal,
    title: 'Bring your own SQL',
    text: 'Paste a query and it goes through the same checks and approval as generated SQL.',
  },
  {
    icon: FileDown,
    title: 'Results you can use',
    text: 'Scrollable tables with the executed SQL alongside, copy, full screen, and export to CSV, JSON or Excel.',
  },
  {
    icon: MessagesSquare,
    title: 'Conversations',
    text: 'Keep a history per topic, rename or delete it, and stop a running request at any time. Light and dark themes.',
  },
];

const SECURITY = [
  'Credentials and chat history are encrypted in your browser with AES-GCM. The key comes from your passphrase through PBKDF2 with 600,000 iterations.',
  'The model sees your question, the schema, your optional description and earlier questions with their SQL from the same conversation, never your credentials or query results.',
  'The server keeps nothing between requests. Pending approvals live in your browser, and any SQL you approve is checked again on the server before it runs.',
  'Optional Basic authentication, a database host allowlist and a SQLite directory allowlist for shared deployments.',
  'Designed as a second layer: connect with a read-only database user and both protections apply.',
];

const FAQS = [
  {
    question: 'What does the model see?',
    answer:
      'Your question, the table and column names with their types and relationships, the description you gave the database, and earlier questions and SQL from the same conversation (so follow-ups work). It never receives your credentials or the rows your queries return.',
  },
  {
    question: 'Can it change my data?',
    answer:
      'Queries are parsed and only a single read-only SELECT or WITH statement is accepted. Approved queries then run inside a read-only transaction with a timeout. For full protection, also connect with a database user that only has read access.',
  },
  {
    question: 'Which models can I use?',
    answer:
      'Any chat model that speaks the OpenAI API and supports tool calling. Set a custom base URL to use another provider or a model running on your own hardware.',
  },
  {
    question: 'Where is my data stored?',
    answer:
      'Everything stays in your browser, encrypted with your passphrase: connections, history, results and pending approvals. The server stores nothing between requests apart from a short-lived schema cache in memory. Clearing the workspace removes everything.',
  },
  {
    question: 'What about very large tables?',
    answer:
      'Every query is capped by a row limit, a response-size limit and a statement timeout. Row counts per table come from database statistics, so they return instantly even on large databases.',
  },
];

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function SectionHead({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <Reveal>
      <div className='section-head'>
        <h2 id={id}>{title}</h2>
        <p>{text}</p>
      </div>
    </Reveal>
  );
}

export default function HomePage() {
  const { scrollY } = useScroll();
  const navBorder = useTransform(scrollY, [0, 40], [0, 1]);

  return (
    <div className='home'>
      <a className='skip-link' href='#main'>
        Skip to content
      </a>
      <header className='home-nav'>
        <motion.span className='home-nav-border' style={{ opacity: navBorder }} />
        <div className='home-container home-nav-inner'>
          <Logo href='/' />
          <nav className='home-links' aria-label='Sections'>
            <a href='#how-it-works'>How it works</a>
            <a href='#features'>Features</a>
            <a href='#security'>Security</a>
            <a href='#faq'>FAQ</a>
          </nav>
          <div className='home-nav-actions'>
            <ThemeToggle />
            <Link href='/workspace' className='btn btn-primary'>
              Open workspace
            </Link>
          </div>
        </div>
      </header>

      <main id='main'>
        <section className='hero' aria-labelledby='hero-title'>
          <div className='hero-grid' aria-hidden='true' />
          <div className='home-container hero-inner'>
            <motion.div
              className='hero-copy'
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <span className='hero-pill'>
                <Database size={13} />
                PostgreSQL · MySQL · SQLite
              </span>
              <h1 id='hero-title'>
                Ask your database anything.
                <br />
                <span className='hero-muted'>Approve every query.</span>
              </h1>
              <p className='hero-lede'>
                Queryroom turns plain-language questions into SQL, shows you exactly what it will
                run, and executes it read-only, only after you approve it.
              </p>
              <div className='hero-actions'>
                <Link href='/workspace' className='btn btn-primary btn-lg'>
                  Open workspace
                  <ArrowRight size={16} />
                </Link>
                <a href='#how-it-works' className='btn btn-secondary btn-lg'>
                  See how it works
                </a>
              </div>
              <ul className='hero-facts'>
                <li>
                  <Check size={14} />
                  Runs on your own server
                </li>
                <li>
                  <Check size={14} />
                  Credentials encrypted in your browser
                </li>
                <li>
                  <Check size={14} />
                  Any OpenAI-compatible model
                </li>
              </ul>
            </motion.div>
            <motion.div
              className='hero-demo'
              initial={{ opacity: 0, y: 32, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
            >
              <ProductDemo />
            </motion.div>
          </div>
        </section>

        <section className='section' id='how-it-works' aria-labelledby='how-it-works-title'>
          <div className='home-container'>
            <SectionHead
              id='how-it-works-title'
              title='From question to answer, with you in the loop'
              text='Every answer follows the same four steps. The only way a query reaches your database is through your approval.'
            />
            <ol className='steps-grid'>
              <motion.span
                className='steps-line'
                aria-hidden='true'
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 1.1, ease: EASE }}
              />
              {STEPS.map((step, index) => (
                <motion.li
                  key={step.title}
                  className='step-card'
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.45, delay: 0.1 + index * 0.12, ease: EASE }}
                >
                  <span className='step-number'>{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>

        <section className='section section-alt' id='features' aria-labelledby='features-title'>
          <div className='home-container'>
            <SectionHead
              id='features-title'
              title='Everything you need to question your data safely'
              text='Built for people who want answers from a database without handing it over to a model.'
            />
            <ul className='feature-grid'>
              {FEATURES.map((feature, index) => (
                <motion.li
                  key={feature.title}
                  className='feature-card'
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, delay: (index % 3) * 0.08, ease: EASE }}
                  whileHover={{ y: -3 }}
                >
                  <span className='feature-icon'>
                    <feature.icon size={17} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </motion.li>
              ))}
            </ul>
          </div>
        </section>

        <section className='section' id='security' aria-labelledby='security-title'>
          <div className='home-container security-grid'>
            <Reveal>
              <div className='security-intro'>
                <span className='feature-icon'>
                  <KeyRound size={17} />
                </span>
                <h2 id='security-title'>Your data stays yours</h2>
                <p>
                  Queryroom is built so that a model can help you write queries without ever holding
                  the keys to your database.
                </p>
                <div className='works-with'>
                  <span>Works with</span>
                  <span className='chip'>PostgreSQL</span>
                  <span className='chip'>MySQL / MariaDB</span>
                  <span className='chip'>SQLite</span>
                  <span className='chip'>OpenAI-compatible APIs</span>
                </div>
              </div>
            </Reveal>
            <ul className='check-list'>
              {SECURITY.map((item, index) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: 16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, delay: index * 0.08, ease: EASE }}
                >
                  <span className='check-icon'>
                    {index === 3 ? <ServerCog size={14} /> : <Check size={14} />}
                  </span>
                  {item}
                </motion.li>
              ))}
            </ul>
          </div>
        </section>

        <section className='section section-alt' id='faq' aria-labelledby='faq-title'>
          <div className='home-container faq-container'>
            <SectionHead
              id='faq-title'
              title='Questions'
              text='What people usually want to know before connecting a database.'
            />
            <Faq />
          </div>
        </section>

        <section className='section'>
          <div className='home-container'>
            <Reveal>
              <div className='cta-card'>
                <h2>Ready to ask your first question?</h2>
                <p>
                  Connect a database, add a model key, choose a passphrase. That is the whole setup.
                </p>
                <Link href='/workspace' className='btn btn-primary btn-lg'>
                  Open workspace
                  <ArrowRight size={16} />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className='home-footer'>
        <div className='home-container home-footer-inner'>
          <div>
            <Logo />
            <p>Read-only text-to-SQL with human approval.</p>
          </div>
          <nav aria-label='Footer'>
            <a href='#features'>Features</a>
            <a href='#security'>Security</a>
            <a href='#faq'>FAQ</a>
            <Link href='/workspace'>Workspace</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className='faq-list'>
      {FAQS.map((item, index) => {
        const expanded = open === index;
        return (
          <div className='faq-item' key={item.question}>
            <h3>
              <button
                aria-expanded={expanded}
                aria-controls={`faq-${index}`}
                id={`faq-button-${index}`}
                onClick={() => setOpen(expanded ? null : index)}
              >
                {item.question}
                <motion.span
                  className='faq-icon'
                  animate={{ rotate: expanded ? 45 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Plus size={16} />
                </motion.span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  id={`faq-${index}`}
                  role='region'
                  aria-labelledby={`faq-button-${index}`}
                  className='faq-answer'
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE }}
                >
                  <p>{item.answer}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
