import Link from 'next/link';

export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#F7F8FA] px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-7 text-center shadow-sm sm:p-9">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1B3A6B] text-xl font-bold text-white">
          P
        </div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Você está sem internet</h1>
        <p className="mt-3 text-sm leading-6 text-[#475569]">
          Esta página continua disponível, mas conversas, campanhas e alterações precisam de conexão.
          Reconecte-se e tente novamente.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#1B3A6B] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#142C52] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] focus-visible:ring-offset-2"
        >
          Tentar novamente
        </Link>
      </section>
    </main>
  );
}
