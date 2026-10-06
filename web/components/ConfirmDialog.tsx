import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** A second, less-preferred way forward (shown between Cancel and the primary button). */
  secondary?: { label: string; onClick: () => void };
  children: ReactNode;
}

/** Modal built on <dialog>, used wherever an action consumes Data 360 query credits. */
export function ConfirmDialog({ open, title, confirmLabel, onConfirm, onCancel, secondary, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onCancel(); }} onClose={onCancel}>
      <div className="dlg">
        <h2 id={titleId}>{title}</h2>
        {children}
        <footer>
          <button onClick={onCancel}>Cancel</button>
          {secondary && <button onClick={secondary.onClick}>{secondary.label}</button>}
          <button className="primary" onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </footer>
      </div>
    </dialog>
  );
}
