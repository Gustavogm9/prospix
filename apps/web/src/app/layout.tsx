import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prospix · Prospecção Inteligente no WhatsApp para Corretores de Seguros',
  description:
    'Plataforma multi-tenant de prospecção inteligente via WhatsApp. Automatize a captação de leads, converse com IA e agende reuniões — tudo em um único painel.',
  metadataBase: new URL('https://prospix.com.br'),
  openGraph: {
    title: 'Prospix · Prospecção Inteligente no WhatsApp',
    description:
      'Automatize prospecção, qualificação e agendamento de reuniões para corretores de seguros com IA.',
    url: 'https://prospix.com.br',
    siteName: 'Prospix',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    locale: 'pt_BR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Prospix',
    description:
      'Prospecção inteligente no WhatsApp para corretores de seguros.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: [{ url: '/logo-mark.svg', type: 'image/svg+xml' }, { url: '/favicon.ico' }],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="antialiased min-h-screen bg-bg text-text">
        {children}
      </body>
    </html>
  );
}
