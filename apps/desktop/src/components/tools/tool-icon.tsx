import {
  siGmail,
  siGithub,
  siGooglecloud,
  siGoogledrive,
  siGooglesheets,
  siKubernetes,
  siLinear,
  siNotion,
  siPostgresql,
  siStripe,
} from 'simple-icons';
import {
  MessageSquare,
  Sparkles,
  HardDrive,
  Globe,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

type SimpleIcon = { title: string; hex: string; path: string };

/**
 * Real brand SVGs from simple-icons (3.4k brand library, official assets).
 * Path data + brand hex is shipped with the package — we render inline SVG
 * for crisp scaling and brand-color fidelity.
 */
const BRAND: Record<string, SimpleIcon> = {
  gmail: siGmail,
  gcloud: siGooglecloud,
  googlecloud: siGooglecloud,
  github: siGithub,
  gh: siGithub,
  stripe: siStripe,
  notion: siNotion,
  k8s: siKubernetes,
  kubernetes: siKubernetes,
  linear: siLinear,
  postgres: siPostgresql,
  postgresql: siPostgresql,
  drive: siGoogledrive,
  googledrive: siGoogledrive,
  sheets: siGooglesheets,
  googlesheets: siGooglesheets,
};

/**
 * Lucide fallbacks for non-brand items (skills, filesystem, browser) and for
 * brands removed from simple-icons (e.g. Slack, after a takedown request).
 */
const FALLBACK: Record<string, LucideIcon> = {
  slack: MessageSquare,
  skill: Sparkles,
  fs: HardDrive,
  filesystem: HardDrive,
  browser: Globe,
};

interface Props {
  name?: string;
  size?: number;
  className?: string;
  /** Override the brand hex (otherwise defaults to the official brand color). */
  color?: string;
}

export function ToolIcon({ name, size = 18, className, color }: Props) {
  const brand = name ? BRAND[name] : undefined;
  if (brand) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={color ?? `#${brand.hex}`}
        className={className}
        role="img"
        aria-label={brand.title}
      >
        <title>{brand.title}</title>
        <path d={brand.path} />
      </svg>
    );
  }

  const Icon: LucideIcon = name ? (FALLBACK[name] ?? Wrench) : Wrench;
  return <Icon size={size} strokeWidth={1.6} className={className} />;
}
