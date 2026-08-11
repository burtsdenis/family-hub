import { t } from '../lib/i18n';
import { useState, type ReactNode } from 'react';
import {
  Modal,
  dialogDanger,
  dialogField,
  dialogGhost,
  dialogLabel,
  dialogPrimary,
} from './Dialog';
import { onEnter } from '../lib/keys';

/**
 * Проекты, папки и календари — разные сущности, но правятся одинаково:
 * название, цвет, иногда один переключатель, удаление и архив.
 * Один диалог на всех вместо трёх почти одинаковых.
 */

export const PALETTE = [
  '#1F6E8C',
  '#6B8F5E',
  '#C4842B',
  '#8C4A6B',
  '#4A6B8C',
  '#8C6B4A',
  '#5A6A74',
  '#7A5C9E',
];

export interface EntityDraft {
  name: string;
  color?: string;
  flag?: boolean;
}

interface Props {
  title: string;
  initial: EntityDraft;
  /** Подпись переключателя. Если не задана — переключателя нет. */
  flagLabel?: string;
  flagHint?: string;
  /** Текст кнопки архива. Если не задан — архива нет. */
  archiveLabel?: string;
  deletable?: boolean;
  deleteHint?: string;
  onSave: (draft: EntityDraft) => Promise<void> | void;
  onArchive?: () => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onClose: () => void;
  /** Дополнительные поля, специфичные для сущности. */
  children?: ReactNode;
}

export function EntityDialog({
  title,
  initial,
  flagLabel,
  flagHint,
  archiveLabel,
  deletable,
  deleteHint,
  onSave,
  onArchive,
  onDelete,
  onClose,
  children,
}: Props) {
  const [draft, setDraft] = useState<EntityDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Не получилось'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={() => {
        if (!busy && draft.name.trim()) {
          void run(() => onSave({ ...draft, name: draft.name.trim() }));
        }
      }}
      footer={
        <>
          {onDelete && deletable && (
            <button
              type="button"
              onClick={() => void run(onDelete)}
              className={`${dialogDanger} mr-auto`}
            >
              {t('Удалить')}
            </button>
          )}
          <button type="button" onClick={onClose} className={dialogGhost}>
            {t('Отмена')}
          </button>
          <button
            type="button"
            disabled={busy || !draft.name.trim()}
            onClick={() => void run(() => onSave({ ...draft, name: draft.name.trim() }))}
            className={dialogPrimary}
          >
            {t('Сохранить')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className={dialogLabel}>{t('Название')}</span>
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={onEnter(() => void run(() => onSave({ ...draft, name: draft.name.trim() })))}
            className={dialogField}
          />
        </label>

        {draft.color !== undefined && (
          <div>
            <span className={dialogLabel}>{t('Цвет')}</span>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={t('Цвет {color}', { color })}
                  onClick={() => setDraft({ ...draft, color })}
                  style={{ backgroundColor: color }}
                  className={`size-7 rounded-full transition-transform ${
                    draft.color?.toLowerCase() === color.toLowerCase()
                      ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface'
                      : 'hover:scale-110'
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {children}

        {flagLabel && (
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={Boolean(draft.flag)}
              onChange={(e) => setDraft({ ...draft, flag: e.target.checked })}
              className="mt-0.5 size-4 accent-[var(--c-accent)]"
            />
            <span>
              <span className="block text-sm text-ink">{flagLabel}</span>
              {flagHint && <span className="block text-xs text-muted">{flagHint}</span>}
            </span>
          </label>
        )}

        {archiveLabel && onArchive && (
          <button
            type="button"
            onClick={() => void run(onArchive)}
            className="text-sm text-muted underline underline-offset-2 hover:text-ink"
          >
            {archiveLabel}
          </button>
        )}

        {deleteHint && !deletable && <p className="text-xs text-muted">{deleteHint}</p>}
        {error && <p className="text-sm text-urgent">{error}</p>}
      </div>
    </Modal>
  );
}
