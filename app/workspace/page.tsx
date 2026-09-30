import type { Metadata } from 'next';
import QueryRoom from '@/features/query-room/QueryRoom';

export const metadata: Metadata = {
  title: 'Workspace · Queryroom',
};

export default function Workspace() {
  return <QueryRoom />;
}
