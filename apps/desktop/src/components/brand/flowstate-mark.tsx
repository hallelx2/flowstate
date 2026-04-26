import { useId } from 'react';

/**
 * The flowstate brand mark — inline SVG so it composes with React props
 * (size, className) and uses ambient color where the splash gradient
 * isn't appropriate.
 *
 * Concept: a sigmoid flow curve connecting an input node (quiet) to an
 * output node (Cohere Ring Blue). Echoes both the splash purple band
 * and the agent Flow view's node-to-node connections.
 */

interface Props {
  size?: number;
  className?: string;
  /** Render the dark hero-gradient background. Off = transparent + currentColor stroke. */
  filled?: boolean;
  title?: string;
}

export function FlowstateMark({
  size = 24,
  className,
  filled = true,
  title = 'flowstate',
}: Props) {
  const reactId = useId();
  const gradId = `fs-bg-${reactId}`;
  const haloId = `fs-halo-${reactId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      {filled && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(282, 32%, 22%)" />
              <stop offset="60%" stopColor="hsl(280, 38%, 12%)" />
              <stop offset="100%" stopColor="hsl(220, 22%, 8%)" />
            </linearGradient>
            <radialGradient id={haloId} cx="80%" cy="20%" r="55%">
              <stop offset="0%" stopColor="hsl(282, 60%, 70%)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(282, 60%, 70%)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill={`url(#${gradId})`} />
          <rect width="64" height="64" rx="14" fill={`url(#${haloId})`} />
        </>
      )}

      {/* Sigmoid flow curve — input → output */}
      <path
        d="M 12 22 C 22 22, 24 42, 32 42 S 42 22, 52 22"
        stroke={filled ? 'hsl(0, 0%, 98%)' : 'currentColor'}
        strokeWidth="3.25"
        fill="none"
        strokeLinecap="round"
        opacity={filled ? 0.92 : 1}
      />

      {/* Input node — quiet */}
      <circle
        cx="12"
        cy="22"
        r="2.75"
        fill={filled ? 'hsl(0, 0%, 98%)' : 'currentColor'}
        opacity={filled ? 0.5 : 0.45}
      />

      {/* Output node — Cohere Ring Blue (signal arrived) */}
      <circle cx="52" cy="22" r="3.5" fill="hsl(228, 72%, 60%)" />
    </svg>
  );
}
