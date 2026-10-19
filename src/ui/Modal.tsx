import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  /** Visually hide the heading (the dialog keeps its accessible name). */
  hideTitle?: boolean;
  onDismiss?: () => void;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
}

/**
 * Accessible modal built on the native <dialog> element: showModal() makes
 * the rest of the page inert and traps focus; focus returns to the element
 * that was focused before opening. Escape calls `onDismiss`.
 */
export function Modal({ title, hideTitle, onDismiss, children, testId, wide }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();

    const handleCancel = (event: Event) => {
      event.preventDefault();
      dismissRef.current?.();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      if (dialog.open) dialog.close();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} data-testid={testId}>
      <div className={wide ? 'panel panel--wide' : 'panel'}>
        <div className="panel__content">
          <h2 id={titleId} className={hideTitle ? 'visually-hidden' : undefined}>
            {title}
          </h2>
          {children}
        </div>
      </div>
    </dialog>
  );
}
