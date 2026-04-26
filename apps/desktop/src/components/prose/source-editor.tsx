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

// Force JetBrains Mono on the editor + every internal text node so it
// outranks any inherited body font. Higher-specificity selectors needed
// because the @uiw/react-codemirror baseTheme uses lots of generic rules.
const FONT_STACK = '"JetBrains Mono", ui-monospace, "SFMono-Regular", monospace';

const cohereCMTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'hsl(0 0% 100%)',
      color: 'hsl(0 0% 0%)',
      fontFamily: FONT_STACK,
      fontSize: '12.5px',
      lineHeight: '1.65',
      height: '100%',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: FONT_STACK,
    },
    '.cm-content, .cm-content *': {
      fontFamily: FONT_STACK,
    },
    '.cm-content': {
      caretColor: 'hsl(218 75% 47%)',
      padding: '16px 0',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'hsl(218 75% 47%)' },
    '.cm-gutters': {
      backgroundColor: 'hsl(0 0% 98%)',
      color: 'hsl(240 5% 60%)',
      border: 'none',
      borderRight: '1px solid hsl(0 0% 95%)',
      paddingRight: '8px',
      fontFamily: FONT_STACK,
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
    // Read-only mode: wrap CodeView so vertical scroll lives at the right level.
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <CodeView code={content} language={language} />
      </div>
    );
  }

  return (
    // h-full + min-h-0 lets us shrink inside a flex parent so the editor
    // can actually overflow + scroll. overflow-hidden caps it to parent.
    <div className="h-full min-h-0 overflow-hidden">
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
        maxHeight="100%"
        style={{ height: '100%', overflow: 'hidden' }}
      />
    </div>
  );
}
