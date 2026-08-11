import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const WIKI_LINK = /\[\[([^\][|]{1,200})\]\]/g;

export interface WikiLinkOptions {
  onNavigate: (title: string) => void;
}

/**
 * Подсветка ссылок вида [[Заголовок]].
 *
 * Реализовано декорациями, а не собственным узлом схемы: текст остаётся
 * обычным текстом, поэтому markdown сериализуется без специальной обработки,
 * а заметка читается как есть даже в блокноте. Цена — ссылка не «объект»,
 * её можно испортить правкой руками, но для личных заметок это скорее плюс.
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
            // Переход только по Cmd/Ctrl — иначе нельзя было бы поставить курсор
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
