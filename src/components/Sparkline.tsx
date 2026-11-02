import { locale, useT } from "../i18n";

/** Daily bars for the last 30 days, oldest first. The label carries the numbers for screen readers. */
export function Sparkline({ daily, className }: { daily: number[]; className?: string }) {
  const t = useT();
  const total = daily.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...daily);
  const w = 120;
  const h = 28;
  const bar = w / daily.length;
  const busiest = daily.reduce((best, n, i) => (n > daily[best] ? i : best), 0);
  const day = new Date(Date.now() - (daily.length - 1 - busiest) * 86_400_000).toLocaleDateString(locale(), {
    month: "short",
    day: "numeric",
    // Usage is bucketed by UTC day (usage.rs).
    timeZone: "UTC",
  });
  const label = total ? t("sparkline.label", { count: total, day, max: daily[busiest] }) : t("sparkline.none");
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className}>
      <title>{label}</title>
      <line x1={0} y1={h - 0.5} x2={w} y2={h - 0.5} className="stroke-border" />
      {daily.map((n, i) => {
        if (!n) return null;
        const bh = Math.max(2, (n / max) * (h - 2));
        return <rect key={i} x={i * bar + 0.5} y={h - 1 - bh} width={bar - 1} height={bh} rx={1} className="fill-accent" />;
      })}
    </svg>
  );
}
