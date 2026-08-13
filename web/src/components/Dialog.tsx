import { t } from '../lib/i18n';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { dialogKeys, onEnter } from '../lib/keys';
import { clearBlankOnBlur } from '../lib/forms';

/**
 * Our own dialogs instead of window.prompt and window.confirm.
 *
 * Native popups can't be styled, they fall outside the interface, and on
 * a tablet they behave unpredictably — especially noticeable on the kiosk.
 * Plus they can't be tested automatically: the browser closes them itself.
 */

export function Modal({
  title,
  children,
  footer,
  onClose,
  onSubmit,
  width = 'max-w-sm',
}: {
  title: string;
  children?: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  /** The dialog's primary action — runs on Enter from anywhere in the window. */
  onSubmit?: () => void;
  width?: string;
}) {
  useEffect(() => {
    const onKey = dialogKeys(() => onSubmit?.(), onClose);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSubmit]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-5 py-20">
      <button
        type="button"
        aria-label={t('Закрыть')}
        onClick={onClose}
        className="fixed inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-label={title}
        className={`relative w-full ${width} rounded-card border border-line bg-surface p-5 shadow-xl`}
      >
        <h2 className="eyebrow mb-4">{title}</h2>
        {children}
        <div className="mt-5 flex items-center justify-end gap-3">{footer}</div>
      </div>
    </div>
  );
}

export const dialogField =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent';
export const dialogLabel = 'mb-1.5 block text-sm font-medium text-ink';
export const dialogPrimary =
  'rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50';
export const dialogGhost = 'px-2 py-2 text-sm text-muted hover:text-ink';
export const dialogDanger =
  'rounded-lg border border-urgent px-4 py-2 text-sm font-medium text-urgent hover:bg-urgent/10';

// ── Context ───────────────────────────────────────────────────────────────

interface PromptOptions {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface DialogApi {
  prompt: (options: PromptOptions) => Promise<string | null>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const DialogContext = createContext<DialogApi | null>(null);

type Pending =
  | { kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(options.value ?? '');
        setPending({ kind: 'prompt', options, resolve });
      }),
    [],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ kind: 'confirm', options, resolve })),
    [],
  );

  useEffect(() => {
    if (pending?.kind === 'prompt') {
      // Select the whole value: the field is almost always rewritten, not appended to
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [pending]);

  function close(result: string | null | boolean) {
    if (!pending) return;
    if (pending.kind === 'prompt') pending.resolve(result as string | null);
    else pending.resolve(Boolean(result));
    setPending(null);
  }

  return (
    <DialogContext.Provider value={{ prompt, confirm }}>
      {children}

      {pending?.kind === 'prompt' && (
        <Modal
          title={pending.options.title}
          onClose={() => close(null)}
          onSubmit={() => close(value.trim() || null)}
          footer={
            <>
              <button type="button" onClick={() => close(null)} className={dialogGhost}>
                {t('Отмена')}
              </button>
              <button
                type="button"
                onClick={() => close(value.trim() || null)}
                className={dialogPrimary}
              >
                {pending.options.confirmLabel ?? t('Готово')}
              </button>
            </>
          }
        >
          <label className="block">
            {pending.options.label && <span className={dialogLabel}>{pending.options.label}</span>}
            <input
              ref={inputRef}
              autoFocus
              value={value}
              placeholder={pending.options.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onBlur={clearBlankOnBlur(() => setValue(''))}
              onKeyDown={onEnter(() => close(value.trim() || null))}
              className={dialogField}
            />
          </label>
        </Modal>
      )}

      {pending?.kind === 'confirm' && (
        <Modal
          title={pending.options.title}
          onClose={() => close(false)}
          onSubmit={() => close(true)}
          footer={
            <>
              <button type="button" onClick={() => close(false)} className={dialogGhost}>
                {t('Отмена')}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => close(true)}
                className={pending.options.danger ? dialogDanger : dialogPrimary}
              >
                {pending.options.confirmLabel ?? t('Подтвердить')}
              </button>
            </>
          }
        >
          {pending.options.message && (
            <p className="text-sm text-muted">{pending.options.message}</p>
          )}
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error(t('useDialogs вызван вне DialogProvider'));
  return ctx;
}
