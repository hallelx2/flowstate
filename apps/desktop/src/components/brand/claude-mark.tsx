/**
 * Claude brand mark — stylized 8-ray asterisk in Anthropic warm orange.
 *
 * Inspired by the public Claude wordmark (we're not redistributing the
 * official asset; this is a clean-room recreation suitable for a UI
 * label that says "this is for Claude").
 */

interface Props {
  size?: number;
  className?: string;
  /** Override the brand color. Defaults to Anthropic warm orange. */
  color?: string;
}

export function ClaudeMark({ size = 18, className, color = '#D97757' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Claude"
      className={className}
      fill={color}
    >
      <title>Claude</title>
      {/* Cardinal rays */}
      <ellipse cx="12" cy="3.6" rx="1.5" ry="3.3" />
      <ellipse cx="12" cy="20.4" rx="1.5" ry="3.3" />
      <ellipse cx="3.6" cy="12" rx="3.3" ry="1.5" />
      <ellipse cx="20.4" cy="12" rx="3.3" ry="1.5" />
      {/* Diagonal rays — same shape rotated 45° around center */}
      <g transform="rotate(45 12 12)">
        <ellipse cx="12" cy="3.6" rx="1.5" ry="3.3" />
        <ellipse cx="12" cy="20.4" rx="1.5" ry="3.3" />
        <ellipse cx="3.6" cy="12" rx="3.3" ry="1.5" />
        <ellipse cx="20.4" cy="12" rx="3.3" ry="1.5" />
      </g>
    </svg>
  );
}
