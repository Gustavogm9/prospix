import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button } from '@prospix/ui';
import { CheckCircle2, Circle, X, ArrowRight, MessageSquare, UserPlus, FileText } from 'lucide-react';

const STORAGE_KEY = 'prospix-onboarding-state-v1';

type StepId = 'whatsapp' | 'firstLead' | 'firstScript';

interface OnboardingState {
  dismissed: boolean;
  completed: Record<StepId, boolean>;
}

const DEFAULT_STATE: OnboardingState = {
  dismissed: false,
  completed: { whatsapp: false, firstLead: false, firstScript: false },
};

function loadState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      dismissed: !!parsed.dismissed,
      completed: {
        whatsapp: !!parsed.completed?.whatsapp,
        firstLead: !!parsed.completed?.firstLead,
        firstScript: !!parsed.completed?.firstScript,
      },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(state: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage indisponível · degrada silenciosamente */
  }
}

interface StepDef {
  id: StepId;
  title: string;
  description: string;
  icon: typeof MessageSquare;
  ctaLabel: string;
  ctaPath: string;
}

const STEPS: StepDef[] = [
  {
    id: 'whatsapp',
    title: 'Conecte seu WhatsApp',
    description: 'Habilite o canal Evolution para receber e responder leads no mesmo número que seus clientes já usam.',
    icon: MessageSquare,
    ctaLabel: 'Conectar agora',
    ctaPath: '/configuracoes?tab=integracoes',
  },
  {
    id: 'firstLead',
    title: 'Cadastre o primeiro lead',
    description: 'Use a busca por Google Maps ou cadastre manualmente. Enriquecimento automático calcula o Fit Score.',
    icon: UserPlus,
    ctaLabel: 'Ir para Leads',
    ctaPath: '/leads',
  },
  {
    id: 'firstScript',
    title: 'Crie seu primeiro roteiro',
    description: 'Defina abordagem comercial para que a IA siga seu tom de voz nas conversas.',
    icon: FileText,
    ctaLabel: 'Criar roteiro',
    ctaPath: '/roteiros',
  },
];

export interface OnboardingChecklistProps {
  /** Sinais opcionais para auto-marcar passos com base no estado real do tenant */
  signals?: Partial<Record<StepId, boolean>>;
}

export const OnboardingChecklist = ({ signals }: OnboardingChecklistProps) => {
  const navigate = useNavigate();
  const [state, setState] = useState<OnboardingState>(() => loadState());

  useEffect(() => {
    if (!signals) return;
    setState((prev) => {
      const next: OnboardingState = {
        ...prev,
        completed: {
          whatsapp: signals.whatsapp ?? prev.completed.whatsapp,
          firstLead: signals.firstLead ?? prev.completed.firstLead,
          firstScript: signals.firstScript ?? prev.completed.firstScript,
        },
      };
      saveState(next);
      return next;
    });
  }, [signals]);

  const totalSteps = STEPS.length;
  const completedCount = STEPS.filter((s) => state.completed[s.id]).length;
  const allDone = completedCount === totalSteps;

  if (state.dismissed || allDone) return null;

  const handleDismiss = () => {
    const next = { ...state, dismissed: true };
    setState(next);
    saveState(next);
  };

  const handleManualComplete = (id: StepId) => {
    const next = {
      ...state,
      completed: { ...state.completed, [id]: true },
    };
    setState(next);
    saveState(next);
  };

  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  return (
    <Card className="bg-white border-primary/30 shadow-sm" aria-labelledby="onboarding-title">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle id="onboarding-title" className="text-base font-bold font-heading text-text">
              Primeiros passos no Prospix
            </CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              {completedCount}/{totalSteps} concluídos · termine a configuração para começar a captar.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-text-secondary hover:text-text transition-colors p-1 rounded"
            aria-label="Dispensar checklist de onboarding"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div
          className="w-full bg-surface-sunken rounded-full h-1.5 mt-3 overflow-hidden"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso do onboarding"
        >
          <div
            className="bg-primary h-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {STEPS.map((step) => {
          const Icon = step.icon;
          const done = state.completed[step.id];
          return (
            <div
              key={step.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                done ? 'bg-success-soft/40 border-success/20' : 'bg-surface-sunken/60 border-border'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {done ? (
                  <CheckCircle2 className="w-5 h-5 text-success-text" aria-label="Concluído" />
                ) : (
                  <Circle className="w-5 h-5 text-text-secondary/60" aria-label="Pendente" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-text-secondary shrink-0" aria-hidden />
                  <h4 className={`text-xs font-bold ${done ? 'text-text-secondary line-through' : 'text-text'}`}>
                    {step.title}
                  </h4>
                </div>
                <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                  {step.description}
                </p>
              </div>
              {!done && (
                <div className="flex flex-col gap-1.5 shrink-0">
                  <Button
                    onClick={() => navigate(step.ctaPath)}
                    className="bg-primary hover:bg-primary-hover text-white text-[10px] font-semibold px-2.5 h-7 rounded-md flex items-center gap-1"
                  >
                    {step.ctaLabel}
                    <ArrowRight className="w-3 h-3" />
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleManualComplete(step.id)}
                    className="text-[9px] text-text-secondary hover:text-text underline"
                    aria-label={`Marcar ${step.title} como concluído`}
                  >
                    Já fiz isso
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default OnboardingChecklist;
