import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

interface Props {
  children: string;
  className?: string;
  /** Compact mode tightens spacing for use inside small cards */
  compact?: boolean;
}

/**
 * Markdown rendered in the Cohere idiom:
 *   - Display serif (Space Grotesk-class) for headings
 *   - Body sans for prose
 *   - Mono uppercase eyebrows for the rare `kbd` / acronyms
 *   - Hairline-border code blocks on snow background
 *   - Cohere-purple left rule on blockquotes (the "rule" indicator)
 */
export function MarkdownView({ children, className, compact = false }: Props) {
  const components: Components = {
    h1: ({ children }) => (
      <h1 className="mt-7 mb-3 font-display text-3xl text-ink first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-7 mb-3 font-display text-2xl text-ink first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-5 mb-2 font-display text-lg text-ink first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-4 mb-2 font-mono text-2xs uppercase tracking-code-wide text-ink-subtle first:mt-0">
        {children}
      </h4>
    ),
    p: ({ children }) => (
      <p className={cn('text-ink leading-relaxed', compact ? 'mb-2' : 'mb-3')}>{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="my-3 list-disc space-y-1 pl-6 marker:text-ink-subtle">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 list-decimal space-y-1 pl-6 marker:text-ink-subtle marker:font-mono marker:text-xs">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-relaxed text-ink">{children}</li>,
    code: ({ children, className: codeCls }) => {
      const isBlock = codeCls?.startsWith('language-');
      if (isBlock) {
        return <code className={codeCls}>{children}</code>;
      }
      return (
        <code className="rounded-sm border border-stone-subtle bg-paper-sunken px-1.5 py-0.5 font-mono text-xs text-ink">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-4 overflow-x-auto rounded-md border border-stone-subtle bg-paper-sunken p-4 font-mono text-xs leading-relaxed">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-4 border-l-2 border-cohere-purple-300 pl-4 italic text-ink-muted">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-6 border-stone-subtle" />,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-ink underline decoration-stone-strong underline-offset-2 transition-colors hover:text-accent-500 hover:decoration-accent-500"
      >
        {children}
      </a>
    ),
    strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    table: ({ children }) => (
      <div className="my-4 overflow-x-auto rounded-md border border-stone-subtle">
        <table className="w-full border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-paper-sunken">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-stone px-3 py-2 text-left font-mono text-2xs uppercase tracking-code text-ink-subtle">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-stone-subtle px-3 py-2 text-sm text-ink last:border-b-0">
        {children}
      </td>
    ),
  };

  return (
    <div className={cn('font-sans text-sm', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
