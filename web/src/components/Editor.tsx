import { t } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from 'tiptap-markdown';
import { WikiLink } from './WikiLink';

/**
 * Сериализатор markdown экранирует квадратные скобки, и [[Ссылка]]
 * превращается в \[\[Ссылка\]\]. При обратном разборе экранирование
 * снимается, поэтому в редакторе всё выглядит правильно — а на диск при
 * этом ложится текст, в котором связь между заметками уже не распознать.
 * Разэкранируем ровно этот случай, не трогая остальную разметку.
 */
function unescapeWikiLinks(markdown: string): string {
  return markdown.replace(/\\\[\\\[([^\][|]{1,200})\\\]\\\]/g, '[[$1]]');
}

// tiptap-markdown кладёт сериализатор в storage, но своих типов не приносит
declare module '@tiptap/core' {
  interface Storage {
    markdown: { getMarkdown: () => string };
  }
}

export interface UploadedFile {
  id: string;
  filename: string;
  is_image: boolean;
  url: string;
}

interface Props {
  /** Меняется только при переключении заметки, не при каждом нажатии клавиши. */
  noteId: string;
  /**
   * Счётчик внешних замен содержимого — например, откат к версии.
   * Редактор держит документ у себя и об изменении initialMarkdown не узнаёт,
   * поэтому его нужно пересоздать явно. Без этого откат выглядел успешным
   * на сервере, но в редакторе оставался прежний текст — и следующее
   * автосохранение возвращало его обратно, отменяя откат.
   */
  revision?: number;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  onNavigate: (title: string) => void;
  onUpload: (files: File[]) => Promise<UploadedFile[]>;
}

const btn =
  'rounded px-2 py-1 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink';
const btnActive = 'rounded px-2 py-1 text-sm bg-accent-soft text-accent';

export function Editor({ noteId, revision = 0, initialMarkdown, onChange, onNavigate, onUpload }: Props) {
  const [dropping, setDropping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef(onUpload);
  uploadRef.current = onUpload;
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false } }),
        Highlight,
        Placeholder.configure({ placeholder: t('Начните писать. [[Ссылка]] связывает заметки') }),
        // Ленивая загрузка: раскодированная фотография занимает мегабайты
        // памяти вкладки независимо от веса файла. В длинной заметке с
        // фотографиями пусть декодируются те, что на экране, а не все сразу.
        Image.configure({
          inline: false,
          HTMLAttributes: { loading: 'lazy', decoding: 'async' },
        }),
        Markdown.configure({ html: false, breaks: true, transformPastedText: true }),
        WikiLink.configure({ onNavigate }),
      ],
      content: initialMarkdown,
      editorProps: {
        attributes: { class: 'note-content' },

        // Перетаскивание файлов в текст. Картинки встают на место броска,
        // остальные файлы просто прикрепляются к заметке.
        handleDrop(view, event, _slice, moved) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (moved || files.length === 0) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void handleFiles(files, at);
          return true;
        },

        handlePaste(_view, event) {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void handleFiles(files);
          return true;
        },
      },
      onUpdate({ editor }) {
        onChange(unescapeWikiLinks(editor.storage.markdown.getMarkdown()));
      },
    },
    // Пересоздаём редактор при смене заметки: так не нужно синхронизировать
    // содержимое вручную и невозможно случайно записать текст не в ту заметку.
    [noteId, revision],
  );

  async function handleFiles(files: File[], at?: number) {
    setUploading(true);
    try {
      const uploaded = await uploadRef.current(files);
      const images = uploaded.filter((f) => f.is_image);
      if (images.length > 0 && editor) {
        const chain = editor.chain().focus();
        if (at !== undefined) chain.setTextSelection(at);
        for (const image of images) {
          chain.setImage({ src: image.url, alt: image.filename });
        }
        chain.run();
      }
    } finally {
      setUploading(false);
      setDropping(false);
    }
  }

  useEffect(() => {
    return () => editor?.destroy();
  }, [editor]);

  if (!editor) return <div className="h-64 animate-pulse rounded-card bg-surface-3" />;

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={() => setDropping(false)}
      className={`relative rounded-card border bg-surface transition-colors ${
        dropping ? 'border-accent' : 'border-line'
      }`}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />

      {(dropping || uploading) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-card bg-surface/80">
          <p className="rounded-lg border border-accent bg-surface px-4 py-2 text-sm text-ink">
            {uploading ? t('Загружаю…') : t('Отпустите — файл прикрепится к заметке')}
          </p>
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: TiptapEditor }) {
  const cls = (active: boolean) => (active ? btnActive : btn);

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5">
      {([1, 2, 3] as const).map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          className={cls(editor.isActive('heading', { level }))}
          title={t('Заголовок {level}', { level })}
        >
          H{level}
        </button>
      ))}

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cls(editor.isActive('bold'))}
        title={t('Полужирный')}
      >
        <b>{t('Ж')}</b>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cls(editor.isActive('italic'))}
        title={t('Курсив')}
      >
        <i>{t('К')}</i>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        className={cls(editor.isActive('highlight'))}
        title={t('Выделение')}
      >
        <span className="bg-[#f4e08a] px-0.5 text-[#131c24]">{t('В')}</span>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={cls(editor.isActive('code'))}
        title={t('Код')}
      >
        <span className="font-mono">{'</>'}</span>
      </button>

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cls(editor.isActive('bulletList'))}
        title={t('Список')}
      >
        •
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cls(editor.isActive('orderedList'))}
        title={t('Нумерованный список')}
      >
        1.
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        className={cls(editor.isActive('taskList'))}
        title={t('Чеклист')}
      >
        ☑
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={cls(editor.isActive('blockquote'))}
        title={t('Цитата')}
      >
        ❝
      </button>
      <button
        type="button"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        className={btn}
        title={t('Таблица')}
      >
        ▦
      </button>

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />

      <button
        type="button"
        onClick={() => editor.chain().focus().insertContent('[[]]').run()}
        className={btn}
        title={t('Ссылка на заметку')}
      >
        [[ ]]
      </button>
    </div>
  );
}
