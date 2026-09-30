import type { Metadata } from 'next';
import HomePage from '@/features/home/HomePage';

export const metadata: Metadata = {
  title: 'Queryroom — Ask your database. Approve every query.',
  description:
    'Turn plain-language questions into read-only SQL for PostgreSQL, MySQL and SQLite. Review every query before it runs.',
};

export default function Home() {
  return <HomePage />;
}
