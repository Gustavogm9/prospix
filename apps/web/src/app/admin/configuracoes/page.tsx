'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, Badge } from '@prospix/ui';
import {
  Settings as SettingsIcon,
  Server,
  User,
  Mail,
  ShieldCheck,
  Clock,
  Hash,
  CreditCard,
  Plug,
  MessageSquare,
  Calendar,
  MapPin,
  Brain,
  ExternalLink,
  Bug,
  MessageCircle,
  Github,
  BookOpen,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth-store';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/v1\/?$/, '');
const ENV_MODE = process.env.NODE_ENV;

const PLANS = [
  {
    name: 'STANDARD',
    price: 'R$ 150,00/mÃªs',
    description: 'Plano padrÃ£o com funcionalidades essenciais para pequenas operaÃ§Ãµes.',
    badge: 'PadrÃ£o',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    name: 'PREMIUM_MULTI',
    price: 'R$ 350,00/mÃªs',
    description: 'Multi-usuÃ¡rio com recursos avanÃ§ados de automaÃ§Ã£o e relatÃ³rios.',
    badge: 'Premium',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
  },
  {
    name: 'ENTERPRISE',
    price: 'Customizado',
    description: 'Plano sob medida para grandes operaÃ§Ãµes com SLA dedicado.',
    badge: 'Enterprise',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
  },
];

const INTEGRATIONS = [
  {
    name: 'Evolution API',
    description: 'Gateway de WhatsApp para envio e recebimento de mensagens.',
    icon: MessageSquare,
    status: 'connected' as const,
  },
  {
    name: 'Google Calendar',
    description: 'SincronizaÃ§Ã£o de agendamentos com calendÃ¡rios Google.',
    icon: Calendar,
    status: 'connected' as const,
  },
  {
    name: 'Google Maps',
    description: 'GeocodificaÃ§Ã£o e validaÃ§Ã£o de endereÃ§os de leads.',
    icon: MapPin,
    status: 'connected' as const,
  },
  {
    name: 'AI Providers',
    description: 'OpenAI, Anthropic e outros provedores de inteligÃªncia artificial.',
    icon: Brain,
    status: 'connected' as const,
  },
];

const QUICK_LINKS = [
  {
    name: 'Sentry Dashboard',
    description: 'Monitoramento de erros e performance.',
    icon: Bug,
    url: 'https://sentry.io',
  },
  {
    name: 'Slack Channel',
    description: 'Canal de comunicaÃ§Ã£o da equipe.',
    icon: MessageCircle,
    url: 'https://slack.com',
  },
  {
    name: 'GitHub Repo',
    description: 'RepositÃ³rio de cÃ³digo-fonte.',
    icon: Github,
    url: 'https://github.com',
  },
  {
    name: 'API Docs',
    description: 'DocumentaÃ§Ã£o da API REST.',
    icon: BookOpen,
    url: `${API_URL}/docs`,
  },
];

const STATUS_INDICATOR: Record<string, { label: string; className: string }> = {
  connected: {
    label: 'Conectado',
    className: 'bg-success-soft text-success-text border-success/30',
  },
  disconnected: {
    label: 'Desconectado',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  pending: {
    label: 'Pendente',
    className: 'bg-amber-50 text-amber-800 border-amber-300',
  },
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  GUILDS_ADMIN: 'Guilds Admin',
};

export default function Settings() {
  const { adminUser } = useAdminAuthStore();

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-primary" aria-hidden />
          ConfiguraÃ§Ãµes
        </h2>
        <p className="text-text-secondary text-xs mt-1">
          InformaÃ§Ãµes do sistema, configuraÃ§Ãµes de convites, planos e integraÃ§Ãµes.
        </p>
      </div>

      {/* Section 1: System Info */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" aria-hidden />
            InformaÃ§Ãµes do Sistema
          </CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Dados do ambiente e sessÃ£o do administrador atual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Environment Details */}
            <div className="space-y-3">
              <InfoRow
                icon={<Server className="w-3.5 h-3.5 text-text-secondary" />}
                label="API URL"
                value={API_URL}
                mono
              />
              <InfoRow
                icon={<Hash className="w-3.5 h-3.5 text-text-secondary" />}
                label="VersÃ£o"
                value="v1.0.0-beta"
              />
              <InfoRow
                icon={<Info className="w-3.5 h-3.5 text-text-secondary" />}
                label="Ambiente"
                value={ENV_MODE}
                badge={
                  ENV_MODE === 'production'
                    ? { text: 'ProduÃ§Ã£o', className: 'bg-success-soft text-success-text border-success/30' }
                    : { text: ENV_MODE, className: 'bg-amber-50 text-amber-800 border-amber-300' }
                }
              />
            </div>

            {/* Admin User */}
            <div className="space-y-3">
              <InfoRow
                icon={<User className="w-3.5 h-3.5 text-text-secondary" />}
                label="Nome"
                value={adminUser?.name || 'â€”'}
              />
              <InfoRow
                icon={<Mail className="w-3.5 h-3.5 text-text-secondary" />}
                label="Email"
                value={adminUser?.email || 'â€”'}
                mono
              />
              <InfoRow
                icon={<ShieldCheck className="w-3.5 h-3.5 text-text-secondary" />}
                label="Papel"
                value={adminUser?.role ? ROLE_LABELS[adminUser.role] || adminUser.role : 'â€”'}
                badge={
                  adminUser?.role
                    ? { text: adminUser.role, className: 'bg-primary/10 text-primary border-primary/20' }
                    : undefined
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Invite Settings */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" aria-hidden />
            ConfiguraÃ§Ãµes de Convites
          </CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            ParÃ¢metros padrÃ£o para geraÃ§Ã£o de convites de usuÃ¡rio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-sunken/50 border border-border">
              <Clock className="w-4 h-4 text-text-secondary mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="text-xs font-semibold text-text">TTL dos Convites</p>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  Os convites expiram automaticamente apÃ³s <span className="font-semibold text-text">7 dias</span> da geraÃ§Ã£o.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-sunken/50 border border-border">
              <Hash className="w-4 h-4 text-text-secondary mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="text-xs font-semibold text-text">Formato do CÃ³digo</p>
                <p className="text-[11px] text-text-secondary mt-0.5">
                  PadrÃ£o: <span className="font-mono font-semibold text-text">PRSPX-XXXX-XXXX</span>
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Available Plans */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" aria-hidden />
                Planos DisponÃ­veis
              </CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Planos de assinatura configurados no sistema.
              </CardDescription>
            </div>
            <Badge className="bg-amber-50 text-amber-800 border border-amber-300 text-[9px] px-2 py-0.5">
              Somente leitura
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className="p-4 rounded-xl border border-border bg-surface-sunken/30 hover:bg-surface-sunken/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <Badge className={`text-[9px] px-1.5 py-0 border ${plan.badgeClass}`}>
                    {plan.badge}
                  </Badge>
                  <span className="text-[10px] font-mono text-text-secondary">{plan.name}</span>
                </div>
                <p className="text-lg font-bold font-heading text-text">{plan.price}</p>
                <p className="text-[11px] text-text-secondary mt-1">{plan.description}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-secondary mt-3 italic flex items-center gap-1">
            <Info className="w-3 h-3" aria-hidden />
            CRUD de planos serÃ¡ implementado em breve.
          </p>
        </CardContent>
      </Card>

      {/* Section 4: Integrations */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
            <Plug className="w-4 h-4 text-primary" aria-hidden />
            IntegraÃ§Ãµes do Sistema
          </CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Status das integraÃ§Ãµes externas configuradas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {INTEGRATIONS.map((integration) => {
              const Icon = integration.icon;
              const statusInfo = STATUS_INDICATOR[integration.status];
              return (
                <div
                  key={integration.name}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-sunken/30 hover:bg-surface-sunken/50 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <Icon className="w-4 h-4 text-text-secondary mt-0.5 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-text">{integration.name}</p>
                      <p className="text-[10px] text-text-secondary mt-0.5 truncate">
                        {integration.description}
                      </p>
                    </div>
                  </div>
                  <Badge className={`text-[9px] px-1.5 py-0 border shrink-0 ml-2 flex items-center gap-1 ${statusInfo?.className ?? ''}`}>
                    <CheckCircle2 className="w-3 h-3" aria-hidden />
                    {statusInfo?.label ?? integration.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Section 5: Quick Links */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-primary" aria-hidden />
            Links RÃ¡pidos
          </CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Acesso rÃ¡pido a ferramentas e documentaÃ§Ã£o.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-sunken/30 hover:bg-surface-sunken/60 hover:border-primary/30 transition-all"
                >
                  <Icon className="w-4 h-4 text-text-secondary group-hover:text-primary mt-0.5 shrink-0 transition-colors" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-text group-hover:text-primary transition-colors flex items-center gap-1">
                      {link.name}
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                    </p>
                    <p className="text-[10px] text-text-secondary mt-0.5">
                      {link.description}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* Reusable info row for the system info section */
function InfoRow({
  icon,
  label,
  value,
  mono,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  badge?: { text: string; className: string };
}) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">
          {label}
        </span>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs text-text ${mono ? 'font-mono' : 'font-medium'} truncate`}>
            {value}
          </span>
          {badge && (
            <Badge className={`text-[9px] px-1.5 py-0 border ${badge.className}`}>
              {badge.text}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
