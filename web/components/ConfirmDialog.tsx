import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

/** Modal built on <dialog>, used wherever an action consumes Data 360 query credits. */
export function ConfirmDialog({ open, title, confirmLabel, onConfirm, onCancel, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} onClose={onCancel}>
      <div className="dlg">
        <h2>{title}</h2>
        {children}
        <footer>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </footer>
      </div>
    </dialog>
  );
}
