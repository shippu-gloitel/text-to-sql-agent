import { Database } from 'lucide-react';
import Link from 'next/link';

export default function Logo({ href }: { href?: '/' | '/workspace' }) {
  const content = (
    <>
      <span className='logo-mark'>
        <Database size={13} strokeWidth={2.25} />
      </span>
      Queryroom
    </>
  );
  return href ? (
    <Link href={href} className='logo' aria-label='Queryroom home'>
      {content}
    </Link>
  ) : (
    <span className='logo'>{content}</span>
  );
}
