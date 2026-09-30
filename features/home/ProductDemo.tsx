'use client';

import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { ArrowUp, Check, LoaderCircle, ShieldCheck, Table2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import SqlCode from '@/features/query-room/components/SqlCode';

const QUESTION = 'Which customers ordered the most last month?';

const SQL = `SELECT c.name, COUNT(o.id) AS orders
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.created_at >= date_trunc('month', now()) - interval '1 month'
  AND o.created_at < date_trunc('month', now())
GROUP BY c.name
ORDER BY orders DESC
LIMIT 5`;

const ROWS = [
  ['Harbor Supply Co.', 42],
  ['Lumen Studio', 37],
  ['Northfield Farms', 29],
  ['Atlas Freight', 24],
  ['Pine & Oak', 19],
] as const;

// typing → asked → drafting → review → approving → running → result
type Phase = 'typing' | 'asked' | 'review' | 'approving' | 'running' | 'result';

const DURATIONS: Record<Phase, number> = {
  typing: QUESTION.length * 38 + 500,
  asked: 1700,
  review: 2600,
  approving: 450,
  running: 900,
  result: 4200,
};

const NEXT: Record<Phase, Phase> = {
  typing: 'asked',
  asked: 'review',
  review: 'approving',
  approving: 'running',
  running: 'result',
  result: 'typing',
};

const enter = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
};

/** A looping, non-interactive replay of a real Queryroom session. */
export default function ProductDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('typing');
  const [typed, setTyped] = useState(0);
  const [cycle, setCycle] = useState(0);

  // With reduced motion, show the finished session without animating.
  const shown: Phase = reduceMotion ? 'result' : phase;
  const typedText = reduceMotion ? QUESTION : QUESTION.slice(0, typed);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const timer = window.setTimeout(() => {
      const next = NEXT[phase];
      if (next === 'typing') {
        setTyped(0);
        setCycle(current => current + 1);
      }
      setPhase(next);
    }, DURATIONS[phase]);
    return () => window.clearTimeout(timer);
  }, [phase, inView, reduceMotion]);

  useEffect(() => {
    if (phase !== 'typing' || !inView || reduceMotion || typed >= QUESTION.length) return;
    const timer = window.setTimeout(() => setTyped(current => current + 1), 38);
    return () => window.clearTimeout(timer);
  }, [phase, typed, inView, reduceMotion]);

  const asked = shown !== 'typing';
  const drafting = shown === 'asked';
  const reviewing = shown === 'review' || shown === 'approving';
  const running = shown === 'running';
  const done = shown === 'result';

  return (
    <div className='demo-window' ref={ref}>
      <p className='sr-only'>
        Product demo: a user asks “{QUESTION}”, reviews the generated SQL, approves it, and gets a
        table of the top five customers.
      </p>
      <div className='demo-titlebar' aria-hidden='true'>
        <span className='demo-dots'>
          <i />
          <i />
          <i />
        </span>
        <span className='demo-title'>{asked ? QUESTION : 'New conversation'}</span>
        <span className='demo-badge'>
          <ShieldCheck size={12} />
          Read-only
        </span>
      </div>

      <div className='demo-body' aria-hidden='true' inert>
        <div className='demo-thread' key={cycle}>
          <AnimatePresence>
            {asked && (
              <motion.div className='msg msg-user' key='question' {...enter}>
                <div className='msg-bubble'>{QUESTION}</div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode='popLayout'>
            {(drafting || running) && (
              <motion.div className='progress' key={shown} {...enter}>
                <div className='progress-row done'>
                  <Check size={14} />
                  Reading schema
                </div>
                {running && (
                  <div className='progress-row done'>
                    <Check size={14} />
                    Approved by you
                  </div>
                )}
                <div className='progress-row current'>
                  <LoaderCircle className='spin' size={14} />
                  {running ? 'Running read-only query…' : 'Drafting and checking SQL…'}
                </div>
              </motion.div>
            )}

            {reviewing && (
              <motion.section className='card' key='review' {...enter}>
                <div className='card-header'>
                  <span className='card-title'>
                    <ShieldCheck size={15} />
                    Review query
                  </span>
                </div>
                <div className='card-body'>
                  <SqlCode sql={SQL} />
                  <div className='meta-row'>
                    Reads from <span className='chip'>customers</span>
                    <span className='chip'>orders</span>
                  </div>
                </div>
                <div className='card-footer'>
                  <motion.span
                    className='btn btn-primary'
                    animate={shown === 'approving' ? { scale: [1, 0.94, 1] } : { scale: 1 }}
                    transition={{ duration: 0.35 }}
                  >
                    Approve and run
                  </motion.span>
                  <span className='btn btn-secondary'>Edit SQL</span>
                  <span className='btn btn-danger-ghost'>Reject</span>
                </div>
              </motion.section>
            )}

            {done && (
              <motion.section className='card' key='result' {...enter}>
                <div className='card-header'>
                  <span className='card-title'>
                    <Table2 size={15} />5 rows · 38 ms
                  </span>
                </div>
                <div className='table-wrap'>
                  <table>
                    <thead>
                      <tr>
                        <th>name</th>
                        <th className='num'>orders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ROWS.map(([name, orders], index) => (
                        <motion.tr
                          key={name}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.12 + index * 0.07, duration: 0.25 }}
                        >
                          <td>{name}</td>
                          <td className='num'>{orders}</td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        <div className='composer demo-composer'>
          <span className='demo-input'>
            {shown === 'typing' ? (
              <>
                {typedText}
                <span className='demo-caret' />
              </>
            ) : (
              <span className='demo-placeholder'>Ask a question or paste a SELECT query…</span>
            )}
          </span>
          <span className='send-btn'>
            <ArrowUp size={16} />
          </span>
        </div>
      </div>
    </div>
  );
}
