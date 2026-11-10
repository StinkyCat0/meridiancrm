import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LogoLockup, LogoMark } from "../../components/layout/Logo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <div className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:px-16">
        <header>
          <Link
            to="/"
            className="inline-flex rounded-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Meridian CRM home"
          >
            <LogoLockup />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>

        <footer className="flex items-center justify-between gap-4 text-[10px] text-muted">
          <span>Meridian Studios</span>
          <span className="label-micro">Precision, by design</span>
        </footer>
      </div>

      <aside className="relative hidden flex-col justify-between overflow-hidden border-l border-border bg-surface/30 p-12 lg:flex">
        <div
          aria-hidden="true"
          className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent"
        />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-7" />
          <span className="label-micro">Meridian CRM</span>
        </div>

        <div className="relative max-w-md">
          <p className="label-micro">The studio statement</p>
          <blockquote className="mt-5 text-[28px] font-light leading-[1.25] tracking-tight text-fg">
            Boutique experiences for brands that value precision, aesthetics, and performance.
          </blockquote>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-muted">
            This is the CRM we use to run the studio: signal instead of noise, an exact pipeline,
            and every relationship kept in view.
          </p>
          <div className="mt-8 h-px w-24 bg-gradient-to-r from-accent to-accent-2" />
        </div>

        <div className="relative grid grid-cols-3 gap-4 border-t border-border pt-6">
          <div>
            <p className="num text-lg font-light text-fg">01</p>
            <p className="label-micro mt-1">Exact pipeline</p>
          </div>
          <div>
            <p className="num text-lg font-light text-fg">02</p>
            <p className="label-micro mt-1">Momentum signal</p>
          </div>
          <div>
            <p className="num text-lg font-light text-fg">03</p>
            <p className="label-micro mt-1">Command palette</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
