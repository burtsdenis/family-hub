import type { KeyboardEvent } from 'react';

/**
 * Enter отправляет форму.
 *
 * Полагаться только на неявную отправку формы браузером оказалось ненадёжно:
 * поведение отличается между полями, браузерами и экранной клавиатурой.
 * Дешевле обработать явно везде, где человек может нажать Enter.
 *
 * Ввод иероглифов и других языков с составным вводом не ломаем: во время
 * набора через IME браузер выставляет isComposing, и Enter там означает
 * «подтвердить символ», а не «отправить».
 */
export function onEnter<T extends HTMLElement>(action: () => void) {
  return (e: KeyboardEvent<T>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    action();
  };
}

/**
 * Клавиши диалога, слушаются на уровне окна: Enter выполняет главное
 * действие, Escape закрывает — где бы ни находился фокус, а не только
 * в текстовом поле с собственным обработчиком.
 *
 * Enter пропускается там, где у него уже есть работа: в textarea и
 * редакторе он вводит перенос строки, на кнопке и ссылке — нажимает их.
 * Полевой обработчик onEnter срабатывает раньше и ставит defaultPrevented,
 * поэтому отправка не задваивается.
 */
export function dialogKeys(submit: () => void, close: () => void) {
  return (e: globalThis.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    submit();
  };
}
