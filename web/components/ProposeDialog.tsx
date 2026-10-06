import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ParamDef } from '@shared/types';
import { buildProposal } from '../lib/github';

interface Props {
  open: boolean;
  onClose: () => void;
  sql: string;
  paramDefs: ParamDef[];
  dataspace: string;
}

/** Turns the current query into a library file and hands it to GitHub as a pull request. */
export function ProposeDialog({ open, onClose, sql, paramDefs, dataspace }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [folder, setFolder] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const proposal = useMemo(
    () =>
      buildProposal(folder, {
        title: title.trim(),
        description: description.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        dataspace: dataspace === 'default' ? undefined : dataspace,
        params: paramDefs,
        sql,
      }),
    [folder, title, description, tags, dataspace, paramDefs, sql],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(proposal.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="dlg">
        <h2 id={titleId}>Propose for the shared library</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The library lives in the repository, so changes go through a GitHub pull request. This opens GitHub with the file pre-filled.
        </p>
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Individuals created this quarter" /></label>
        <label>Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="row">
          <label className="grow">Tags (comma separated)<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="profile, audit" /></label>
          <label className="grow">Folder<input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="profiles" /></label>
        </div>
        <div className="small muted">File: <code>queries/{proposal.id}.sql</code></div>
        {title.trim() && proposal.errors.length > 0 && (
          <div className="alert error small">{proposal.errors.map((e) => <div key={e}>{e}</div>)}</div>
        )}
        {proposal.url === null && (
          <div className="alert warn small">This query is too long to pass through a link. Copy the file, then paste it into GitHub’s new-file page.</div>
        )}
        <footer>
          <button onClick={onClose}>Close</button>
          <button onClick={() => void copy()} disabled={!title.trim()}>{copied ? 'Copied' : 'Copy file'}</button>
          <a
            className={`primary${!title.trim() || proposal.errors.length ? ' disabled' : ''}`}
            href={proposal.url ?? proposal.blankUrl}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!title.trim() || proposal.errors.length > 0}
            onClick={(e) => { if (!title.trim() || proposal.errors.length) e.preventDefault(); }}
          >
            <button className="primary" tabIndex={-1} disabled={!title.trim() || proposal.errors.length > 0}>Open on GitHub</button>
          </a>
        </footer>
      </div>
    </dialog>
  );
}
