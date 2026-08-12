// Линтер настроен узко и по делу: рекомендованный TypeScript-набор плюс
// react-hooks — нестабильные идентичности хуков уже приводили к тихим
// циклам запросов, это главные грабли проекта. Стилистику держит сам
// TypeScript и код-ревью, правил-вкусовщины здесь нет.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // «Загрузить при монтировании и положить в state» — основной способ
      // получения данных в этом приложении; правило метит каждое такое место.
      // Реальные грабли (циклы из-за нестабильных зависимостей) ловит
      // exhaustive-deps — он остаётся ошибкой.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    rules: {
      // Пустой catch — осознанный паттерн проекта («нет localStorage — ну и
      // ладно»), но переменная ошибки без использования — мусор
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
