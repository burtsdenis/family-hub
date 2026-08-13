import type { ReactNode } from 'react';

/**
 * narrow — формы и настройки, шире делать нечего.
 * default — растёт ступенями до 1920px: колонки множатся, строки не удлиняются.
 * full — занимает всё, что дают. Для доски задач, где колонок четыре.
 */
type Width = 'narrow' | 'default' | 'full';

const WIDTH: Record<Width, string> = {
  narrow: 'max-w-3xl',
  // Ширина растёт непрерывно до 1920px, а не ступенями по точкам останова.
  // Ступени создают ровно ту же проблему, от которой мы уходим: между
  // соседними порогами область снова перестаёт расти и по краям копится пустота.
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

/** Пустой экран — это приглашение к действию, а не извинение. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}
