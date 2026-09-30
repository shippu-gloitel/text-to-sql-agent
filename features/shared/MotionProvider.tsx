'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/** Respects the operating system's "reduce motion" setting for every animation. */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion='user'>{children}</MotionConfig>;
}
