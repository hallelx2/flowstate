import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { FlowstateMark } from '@/components/brand/flowstate-mark';

/**
 * The boot sequence — Cohere drama in restraint.
 *
 * Composition:
 *   ┌─────────────────────────────────────────┐
 *   │     ░░░░ DEEP PURPLE HERO BAND ░░░░     │  <- Cohere's signature
 *   │              [tiny mono tag]            │
 *   ├─────────────────────────────────────────┤  <- hairline horizon
 *   │                                         │
 *   │            f l o w s t a t e            │  <- CohereText display
 *   │                                         │
 *   │           rotating mono phrase          │
 *   │                                         │
 *   └─────────────────────────────────────────┘
 *
 * No spinners. No grain. Authority through whitespace + dramatic type.
 */

const phrases = [
  'gathering your tools',
  'reading your skills',
  'warming the agents',
  'tuning the flow',
];

export function LoadingScreen() {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPhraseIndex((i) => (i + 1) % phrases.length), 700);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative grid h-full w-full grid-rows-[280px_1fr] bg-paper">
      {/* ─── Cohere purple hero band ─── */}
      <div className="cohere-hero relative overflow-hidden app-drag">
        {/* Soft halo */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.4, ease: 'easeOut' }}
          className="pointer-events-none absolute -right-32 -top-24 h-[360px] w-[360px] rounded-full"
          style={{
            background: 'radial-gradient(closest-side, hsl(282 60% 70% / 0.35), transparent 70%)',
          }}
        />
        {/* Mono uppercase eyebrow inside the band */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="absolute left-10 top-8 flex items-center gap-2.5 text-paper/80"
        >
          <FlowstateMark size={20} filled={false} className="text-paper opacity-90" />
          <span className="font-mono text-2xs uppercase tracking-code-wide">
            FLOWSTATE&nbsp;&nbsp;·&nbsp;&nbsp;V0.1.0&nbsp;&nbsp;·&nbsp;&nbsp;LOCAL
          </span>
        </motion.div>

        {/* System status — top right inside band */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="absolute right-10 top-8 flex flex-col items-end gap-1 text-paper/70"
        >
          <span className="font-mono text-2xs uppercase tracking-code">UNAUTHENTICATED</span>
          <span className="font-mono text-2xs text-paper/50">no telemetry</span>
        </motion.div>

        {/* Inset hero label */}
        <div className="absolute bottom-10 left-10 right-10">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="font-display text-paper text-2xl leading-tight"
          >
            Talk to your agents like you talk
            <br />
            to a&nbsp;<span className="italic font-light">person</span>.
          </motion.p>
        </div>
      </div>

      {/* ─── White canvas: wordmark + status ─── */}
      <div className="relative flex flex-col items-center justify-center px-10 app-no-drag">
        {/* Hairline marker — minimal vertical signature */}
        <motion.div
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="absolute top-0 left-1/2 h-8 w-px -translate-x-1/2 origin-top bg-stone"
        />

        {/* Display wordmark — Fraunces filling the canvas */}
        <motion.h1
          initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 1.0, delay: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
          className="font-display text-7xl text-ink"
        >
          <span className="italic font-light">flow</span>
          <span>state</span>
        </motion.h1>

        {/* Underline — sole touch of accent */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 1.0, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-5 h-px w-32 origin-center bg-ink"
        />

        {/* Rotating phrase */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 1.2 }}
          className="mt-7 flex h-5 items-center gap-2.5"
        >
          <span className="flex gap-1">
            <span className="h-1 w-1 rounded-full bg-ink-subtle/70 animate-flicker" />
            <span
              className="h-1 w-1 rounded-full bg-ink-subtle/70 animate-flicker"
              style={{ animationDelay: '180ms' }}
            />
            <span
              className="h-1 w-1 rounded-full bg-ink-subtle/70 animate-flicker"
              style={{ animationDelay: '360ms' }}
            />
          </span>
          <motion.span
            key={phraseIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="font-mono text-2xs uppercase tracking-code text-ink-subtle"
          >
            {phrases[phraseIndex]}
          </motion.span>
        </motion.div>

        {/* Bottom marginalia */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-stone-subtle px-10 py-4">
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            ⌘ K · open anywhere
          </span>
          <span className="font-mono text-2xs uppercase tracking-code text-ink-subtle">
            your machine · no telemetry
          </span>
        </div>
      </div>
    </div>
  );
}
