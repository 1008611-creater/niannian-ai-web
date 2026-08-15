export function Logo({ withName = false }: { withName?: boolean }) {
  return (
    <span className="logo-wrap" aria-label="念念 AI">
      <img className="logo-mark" src="/niannian-ai-authority-gold.svg?v=niannian-logo-authority-gold-20260802-02" alt="" aria-hidden="true" />
      {withName ? <span className="logo-name">念念 AI</span> : null}
    </span>
  );
}
