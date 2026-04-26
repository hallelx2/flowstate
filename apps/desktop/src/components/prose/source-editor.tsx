import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import type { Extension } from '@codemirror/state';
import { CodeView } from './code-view';

/**
 * Toggleable read-only / edit view for a source file.
 *
 * Editing uses CodeMirror 6 with a Cohere-themed light editor. Read-only
 * uses our prism-based CodeView (no editor weight when you're just looking).
 *
 * For now edits live in component state — persistence to disk happens
 * through IPC in a future commit.
 */

interface Props {
  content: string;
  language: 'yaml' | 'markdown' | 'plaintext';
  editing: boolean;
  onChange?: (content: string) => void;
}

const cohereCMTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'hsl(0 0% 100%)',
      color: 'hsl(0 0% 0%)',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: '12px',
      lineHeight: '1.6',
      height: '100%',
    },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-content': {
      caretColor: 'hsl(218 75% 47%)',
      padding: '20px 0',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(218 75% 47%)' },
    '.cm-gutters': {
      backgroundColor: 'hsl(0 0% 98%)',
      color: 'hsl(240 5% 60%)',
      border: 'none',
      borderRight: '1px solid hsl(0 0% 95%)',
      paddingRight: '8px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px',
      fontSize: '11px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'hsl(218 75% 47%)',
    },
    '.cm-activeLine': { backgroundColor: 'hsl(218 80% 97% / 0.4)' },
    '.cm-selectionBackground, ::selection, .cm-content ::selection': {
      backgroundColor: 'hsl(218 80% 92%) !important',
    },
    '.cm-line': { padding: '0 16px' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'hsl(218 80% 92%) !important',
    },
  },
  { dark: false },
);

function langExtension(lang: Props['language']): Extension[] {
  if (lang === 'markdown') return [markdown()];
  if (lang === 'yaml') return [yaml()];
  return [];
}

export function SourceEditor({ content, language, editing, onChange }: Props) {
  if (!editing) {
    return <CodeView code={content} language={language} />;
  }

  return (
    <div className="h-full">
      <CodeMirror
        value={content}
        extensions={[...langExtension(language), cohereCMTheme]}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          autocompletion: false,
          searchKeymap: true,
        }}
        theme="light"
        height="100%"
      />
    </div>
  );
}
