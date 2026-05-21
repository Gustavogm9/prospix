import type { Metadata } from 'next';
import '@prospix/ui/globals.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prospix · Prospecção Inteligente no WhatsApp para Corretores de Seguros',
  description: 'Sua máquina de prospecção automatizada. Varre o Google Places, qualifica leads via WhatsApp com IA e agenda reuniões direto no seu calendário. Você só aparece para vender.',
  metadataBase: new URL('https://prospix.com.br'),
  openGraph: {
    title: 'Prospix · Prospecção Inteligente no WhatsApp para Corretores de Seguros',
    description: 'A IA do Prospix captura leads ideais, inicia conversas qualificadas e agenda reuniões. Você só aparece para vender.',
    url: 'https://prospix.com.br',
    siteName: 'Prospix',
    locale: 'pt_BR',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Prospix - Prospecção inteligente',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Prospix · Prospecção Inteligente para Corretores',
    description: 'A IA captura, qualifica e agenda reuniões direto no seu Google Calendar.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
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
