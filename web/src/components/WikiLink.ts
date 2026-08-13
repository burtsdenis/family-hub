import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const WIKI_LINK = /\[\[([^\][|]{1,200})\]\]/g;

export interface WikiLinkOptions {
  onNavigate: (title: string) => void;
}

/**
 * Highlighting of [[Title]]-style links.
 *
 * Implemented with decorations rather than a custom schema node: the text
 * stays plain text, so markdown serializes with no special handling and
 * the note reads as-is even in a plain text editor. The price: a link is
 * not an "object" and can be broken by hand-editing — but for personal
 * notes that's arguably a plus.
 */
export const WikiLink = Extension.create<WikiLinkOptions>({
  name: 'wikiLink',

  addOptions() {
    return { onNavigate: () => {} };
  },

  addProseMirrorPlugins() {
    const { onNavigate } = this.options;

    return [
      new Plugin({
        key: new PluginKey('wikiLink'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const match of node.text.matchAll(WIKI_LINK)) {
                const from = pos + (match.index ?? 0);
                decorations.push(
                  Decoration.inline(from, from + match[0].length, {
                    class: 'wiki-link',
                    'data-title': match[1]?.trim() ?? '',
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },

          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement | null;
            const title = target?.closest<HTMLElement>('.wiki-link')?.dataset['title'];
            // Navigate only with Cmd/Ctrl — otherwise placing the cursor would be impossible
            if (title && (event.metaKey || event.ctrlKey)) {
              onNavigate(title);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
