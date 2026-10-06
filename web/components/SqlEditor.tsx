import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionSource } from '@codemirror/autocomplete';
import { PostgreSQL, keywordCompletionSource, sql } from '@codemirror/lang-sql';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import type { ObjectMeta } from '@shared/types';

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--cm-kw)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--cm-str)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--cm-num)' },
  { tag: [t.lineComment, t.blockComment], color: 'var(--cm-com)', fontStyle: 'italic' },
  { tag: [t.name, t.quote], color: 'var(--cm-ident)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)' },
});

/** Completes quoted object and field names from metadata; fields of objects already in the query rank first. */
export function schemaSource(objects: ObjectMeta[]): CompletionSource {
  const tables: Completion[] = objects.map((o) => ({ label: `"${o.name}"`, type: 'class', detail: o.kind.toUpperCase(), info: o.label, boost: 1 }));
  const fieldsOf = new Map<string, Completion[]>(
    objects.map((o) => [
      o.name,
      o.fields.map((f) => ({ label: `"${f.name}"`, type: 'property', detail: o.label, info: `${f.label} · ${f.type}`, boost: 2 })),
    ]),
  );
  const fallback = new Map<string, Completion>();
  for (const o of objects) for (const f of o.fields) if (!fallback.has(f.name)) fallback.set(f.name, { label: `"${f.name}"`, type: 'property', detail: f.type });
  const fallbackList = [...fallback.values()].slice(0, 5000);

  return (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/"?\w*$/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const doc = ctx.state.doc.toString();
    const referenced = objects.filter((o) => doc.includes(`"${o.name}"`));
    const fields = referenced.length ? referenced.flatMap((o) => fieldsOf.get(o.name) ?? []) : fallbackList;
    return { from: word.from, options: [...tables, ...fields], validFor: /^"?\w*$/ };
  };
}

interface Props {
  /** Initial text, and the text to load whenever `resetKey` changes. */
  value: string;
  /**
   * Bump to replace the document with `value`. The editor owns its text while the user types:
   * pushing every `value` change back in would race with fast typing and garble the document.
   */
  resetKey: number;
  onChange: (v: string) => void;
  onRun: () => void;
  /** Alt+Shift+F. */
  onFormat?: () => void;
  /** False while the editor sits in a hidden tab; it re-measures when shown again. */
  visible?: boolean;
  objects: ObjectMeta[];
}

export function SqlEditor({ value, resetKey, onChange, onRun, onFormat, visible = true, objects }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const completions = useRef(new Compartment());
  const cbs = useRef({ onChange, onRun, onFormat });
  cbs.current = { onChange, onRun, onFormat };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(
            keymap.of([
              { key: 'Mod-Enter', run: () => (cbs.current.onRun(), true) },
              { key: 'Alt-Shift-f', run: () => (cbs.current.onFormat?.(), true) },
            ]),
          ),
          basicSetup,
          sql({ dialect: PostgreSQL, upperCaseKeywords: true }),
          syntaxHighlighting(highlight),
          theme,
          keymap.of(completionKeymap),
          completions.current.of(autocompletion({ override: [schemaSource([]), keywordCompletionSource(PostgreSQL, true)] })),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cbs.current.onChange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ 'aria-label': 'SQL editor' }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // Intentionally runs once on mount.
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: completions.current.reconfigure(autocompletion({ override: [schemaSource(objects), keywordCompletionSource(PostgreSQL, true)] })),
    });
  }, [objects]);

  useEffect(() => {
    if (visible) view.current?.requestMeasure();
  }, [visible]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    // Only resetKey triggers a reload; `value` is deliberately not a dependency.
  }, [resetKey]);

  return <div className="editor" ref={host} />;
}
