import { useState, type ReactNode } from 'react';
import { orderCategories, type Category } from '../lib/money';

/*
  The category picker, collapsed to the top level (#73).

  Once a household actually uses subcategories the flat wall stops
  working: a real hub counted 26 chips where the collapsed view needs 11.
  So only top-level categories show, and tapping a parent does two things
  at once — it becomes the chosen category AND its children appear
  underneath. The common case ("groceries, no detail") stays one tap;
  refining is a second tap on a child, which replaces the choice.

  The useful consequence: expansion is not state. The open folder is
  always the selected category or the parent of it, so switching parents
  closes the previous folder by itself, and editing an existing
  transaction opens with the right folder showing because the selection
  came with the draft. The one exception needs the one flag below:
  a second tap on the already-selected parent collapses the folder while
  KEEPING the selection — "groceries, and I don't need the detail" must
  not cost the person their choice. The flag resets whenever the
  selection moves, so a stale "collapsed" cannot survive it.

  Shared by the quick-expense form and the transaction dialog on
  purpose — the month summary already rolls children into their parent,
  and this must read as the same idea, not a second one.
*/

const chip = 'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors';
const chipOn = 'border-accent bg-accent-soft text-accent';
const chipOff = 'border-line text-muted hover:text-ink';

interface Props {
  categories: Category[];
  kind?: 'expense' | 'income';
  /** The selected category id, '' for none. */
  value: string;
  onChange: (id: string) => void;
  /** Trailing extras — the "+ category" button and the like. */
  children?: ReactNode;
}

export function CategoryChips({ categories, kind, value, onChange, children }: Props) {
  // The id of a selected parent whose folder was deliberately closed —
  // the single piece of expansion state that does not follow from the
  // selection (see the header comment)
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);

  const ordered = orderCategories(categories, kind);
  const roots = ordered.filter((e) => e.depth === 0).map((e) => e.category);
  const childrenOf = new Map<string, Category[]>();
  for (const e of ordered) {
    if (e.depth === 1 && e.category.parent_id) {
      const list = childrenOf.get(e.category.parent_id) ?? [];
      list.push(e.category);
      childrenOf.set(e.category.parent_id, list);
    }
  }

  const selected = categories.find((c) => c.id === value);
  // Derived: the folder that is open is the selected parent, or the
  // selected child's parent — unless deliberately collapsed
  const openParent =
    selected === undefined
      ? null
      : selected.parent_id && childrenOf.has(selected.parent_id)
        ? selected.parent_id
        : childrenOf.has(selected.id)
          ? selected.id
          : null;
  const visibleFolder = openParent === collapsedFor ? null : openParent;

  function pick(id: string) {
    setCollapsedFor(null);
    onChange(id);
  }

  function tapParent(parent: Category) {
    if (value === parent.id) {
      // Keep the selection, fold or unfold the detail
      setCollapsedFor(collapsedFor === parent.id ? null : parent.id);
      return;
    }
    pick(parent.id);
  }

  function tapLeaf(c: Category) {
    // A leaf keeps the old toggle: tapping the chosen one clears it
    pick(value === c.id ? '' : c.id);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {roots.map((root) => {
        const kids = childrenOf.get(root.id) ?? [];
        const open = visibleFolder === root.id;
        return (
          <span key={root.id} className="contents">
            <button
              type="button"
              data-chip
              onClick={() => (kids.length > 0 ? tapParent(root) : tapLeaf(root))}
              className={`${chip} ${value === root.id ? chipOn : chipOff}`}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: root.color }} aria-hidden />
              {root.name}
              {/* A parent with nothing inside must be indistinguishable
                  from an ordinary category — the caret only marks real
                  folders */}
              {kids.length > 0 && (
                <span className="text-xs opacity-60" aria-hidden>
                  {open ? '▾' : '▸'}
                </span>
              )}
            </button>
            {open &&
              kids.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-chip
                  onClick={() => tapLeaf(c)}
                  className={`${chip} ${value === c.id ? chipOn : chipOff}`}
                >
                  <span aria-hidden>↳</span>
                  <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                  {c.name}
                </button>
              ))}
          </span>
        );
      })}
      {children}
    </div>
  );
}
