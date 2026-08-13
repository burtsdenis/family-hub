import type { ReactNode } from 'react';

/**
 * narrow — forms and settings; nothing to gain from going wider.
 * default — grows up to 1920px: columns multiply, lines don't stretch.
 * full — takes everything it's given. For the task board with its four columns.
 */
type Width = 'narrow' | 'default' | 'full';

const WIDTH: Record<Width, string> = {
  narrow: 'max-w-3xl',
  // Width grows continuously up to 1920px, not in breakpoint steps.
  // Steps recreate exactly the problem we're escaping: between adjacent
  // thresholds the area stops growing again and emptiness piles up at the edges.
  default: 'max-w-[120rem]',
  full: 'max-w-none',
};

export function Page({
  title,
  eyebrow,
  action,
  width = 'default',
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  width?: Width;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto w-full ${WIDTH[width]} px-5 py-7 sm:px-8 sm:py-9 3xl:px-12`}>
      {/* flex-wrap: on phones a wide action block (say, the calendar view
          switcher) wraps below the title instead of being cut off by the
          screen edge */}
      <header className="mb-7 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

/** An empty screen is an invitation to act, not an apology. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}
