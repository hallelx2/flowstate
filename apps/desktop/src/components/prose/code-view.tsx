import { Highlight, type PrismTheme } from 'prism-react-renderer';
import { cn } from '@/lib/cn';

/**
 * Custom Prism theme built from Cohere palette.
 *
 * Color picks:
 *   - keys (frontmatter / yaml properties)  → Interaction Blue (the focal point)
 *   - strings                                → Cohere purple (the "voice")
 *   - numbers / booleans                     → ink (data is data)
 *   - punctuation / operators                → muted slate (out of the way)
 *   - comments                               → ink-subtle italic
 *   - tags / keywords (markdown headings)    → cohere-purple bold
 */
const cohereTheme: PrismTheme = {
  plain: {
    color: 'hsl(0 0% 13%)',
    backgroundColor: 'transparent',
  },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: 'hsl(240 5% 60%)', fontStyle: 'italic' } },
    { types: ['string', 'attr-value', 'char'], style: { color: 'hsl(282 38% 32%)' } },
    { types: ['number', 'boolean'], style: { color: 'hsl(0 0% 0%)' } },
    { types: ['keyword', 'tag', 'important'], style: { color: 'hsl(282 38% 28%)', fontWeight: '500' as const } },
    // YAML keys / property names — the focal Interaction Blue
    { types: ['atrule', 'attr-name', 'property'], style: { color: 'hsl(218 75% 47%)' } },
    { types: ['punctuation', 'operator'], style: { color: 'hsl(240 5% 55%)' } },
    { types: ['function'], style: { color: 'hsl(0 0% 0%)' } },
    { types: ['variable', 'constant', 'symbol'], style: { color: 'hsl(0 0% 0%)' } },
    { types: ['regex'], style: { color: 'hsl(282 38% 32%)' } },
    { types: ['namespace'], style: { opacity: 0.7 } },
    { types: ['url'], style: { color: 'hsl(218 75% 47%)', textDecorationLine: 'underline' } },
    { types: ['inserted'], style: { color: 'hsl(150 50% 30%)' } },
    { types: ['deleted'], style: { color: 'hsl(0 65% 45%)' } },
    // Markdown specifics
    { types: ['title'], style: { color: 'hsl(0 0% 0%)', fontWeight: '500' as const } },
    { types: ['blockquote'], style: { color: 'hsl(282 38% 32%)', fontStyle: 'italic' } },
    { types: ['code-snippet'], style: { backgroundColor: 'hsl(0 0% 95%)', color: 'hsl(0 0% 13%)' } },
  ],
};

interface Props {
  code: string;
  /** Prism language id — 'yaml', 'markdown', 'json', 'bash', 'typescript', etc. */
  language?: string;
  /** Show line numbers (default true) */
  showLineNumbers?: boolean;
  className?: string;
}

export function CodeView({ code, language = 'yaml', showLineNumbers = true, className }: Props) {
  return (
    <Highlight theme={cohereTheme} code={code.trim()} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre
          className={cn(
            'overflow-x-auto bg-paper-sunken p-5 font-mono text-xs leading-relaxed',
            className,
          )}
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })} className="table-row">
              {showLineNumbers && (
                <span className="table-cell select-none pr-4 text-right font-mono text-2xs text-ink-subtle/50">
                  {i + 1}
                </span>
              )}
              <span className="table-cell">
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}
