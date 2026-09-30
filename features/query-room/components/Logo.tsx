import { Database } from 'lucide-react';

export default function Logo() {
  return (
    <span className='logo'>
      <span className='logo-mark'>
        <Database size={13} strokeWidth={2.25} />
      </span>
      Queryroom
    </span>
  );
}
