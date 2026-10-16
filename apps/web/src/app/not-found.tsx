import Link from 'next/link';
import { ArrowLeft, SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-bg p-6 text-center">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
          <SearchX className="h-7 w-7 text-primary" aria-hidden />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Erro 404</p>
          <h1 className="text-2xl font-bold text-text font-heading">Página não encontrada</h1>
          <p className="text-sm leading-relaxed text-text-secondary">
            O endereço informado não existe ou foi movido. Volte ao início para continuar usando o Prospix.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
