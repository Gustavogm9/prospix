import React, { useEffect, useId, useRef, useState } from 'react';
import { Target, Search, FileText, MessageSquare, Calendar, X, ChevronRight, Bot } from 'lucide-react';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    icon: Target,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    title: '1. Descoberta de Leads',
    description: 'Nós ajudamos você a encontrar os clientes certos. O sistema realiza varreduras automáticas no Google Maps e na Web para localizar empresas e negócios qualificados para o seu serviço.',
    imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=600&h=400',
  },
  {
    icon: Search,
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
    title: '2. Enriquecimento Inteligente',
    description: 'Deixe a pesquisa pesada com a gente. Usamos algoritmos avançados para vasculhar a internet e extrair os números de WhatsApp, e-mails e contatos dos decisores de forma totalmente automática.',
    imageUrl: 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?auto=format&fit=crop&q=80&w=600&h=400',
  },
  {
    icon: FileText,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    title: '3. Roteiros Gerados por IA',
    description: 'Nada de copiar e colar textos engessados. Nossa Inteligência Artificial escreve mensagens de abordagem únicas e altamente persuasivas baseadas no perfil exato de cada lead.',
    imageUrl: 'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&q=80&w=600&h=400',
  },
  {
    icon: MessageSquare,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    title: '4. Disparo & Automação',
    description: 'Você só precisa conectar o seu WhatsApp através de um QR Code. Depois, as campanhas rodam sozinhas em segundo plano, disparando mensagens nos horários configurados.',
    imageUrl: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&q=80&w=600&h=400',
  },
  {
    icon: Calendar,
    color: 'text-indigo-500',
    bg: 'bg-indigo-500/10',
    title: '5. Qualificação & Agendamento',
    description: 'A IA do Prospix ajuda a identificar a intenção e conduzir a qualificação. Quando houver interesse em reunião, a equipe confirma o horário na agenda e a sincronização com o Google.',
    imageUrl: 'https://images.unsplash.com/photo-1506784365847-bbad939e9335?auto=format&fit=crop&q=80&w=600&h=400',
  }
];

export function TutorialModal({ isOpen, onClose }: TutorialModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!isOpen) { setCurrentStep(0); return; }
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const step = STEPS[currentStep];
  if (!step) return null;
  const Icon = step.icon;

  return (
    <dialog ref={dialogRef} aria-label="Como funciona" aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      className="fixed inset-0 m-auto h-fit w-[calc(100%_-_2rem)] max-w-4xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-text shadow-2xl backdrop:bg-black/60"
    >
      {/* Modal */}
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <button 
          onClick={onClose}
          aria-label="Fechar como funciona"
          className="absolute top-4 right-4 flex h-11 w-11 items-center justify-center z-10 rounded-full bg-surface-sunken text-primary backdrop-blur-md transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex max-h-[calc(100dvh_-_2rem)] flex-col md:h-[500px] md:flex-row">
          {/* Left Side - Visual/Image */}
          <div className="w-full md:w-1/2 relative bg-[#142C52] overflow-hidden hidden md:block">
            <img 
              src={step.imageUrl} 
              alt={step.title}
              className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-overlay transition-opacity duration-500"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A1629] via-transparent to-transparent" />
            <div className="absolute inset-0 p-8 flex flex-col justify-end">
              <div className="flex items-center gap-2 mb-4">
                <Bot className="w-6 h-6 text-[#E8981C]" />
                <span className="text-white font-bold tracking-widest text-sm uppercase">Prospix</span>
              </div>
              <h2 className="text-3xl font-bold text-white mb-2 leading-tight">
                Sua máquina de prospecção autônoma.
              </h2>
            </div>
          </div>

          {/* Right Side - Content */}
          <div className="w-full min-h-0 md:w-1/2 p-5 pt-16 md:p-10 flex flex-col bg-white relative">
            
            {/* Progress indicators */}
            <div className="flex shrink-0 gap-1.5 mb-5">
              {STEPS.map((_, idx) => (
                <div 
                  key={idx} 
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === currentStep ? 'w-8 bg-primary' : 'w-2 bg-gray-200'
                  }`}
                />
              ))}
            </div>

            {/* Content */}
            <div role="region" aria-label="Explicação do funcionamento" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <div className={`w-14 h-14 rounded-2xl ${step.bg} ${step.color} flex items-center justify-center mb-6`}>
                <Icon className="w-7 h-7" />
              </div>
              
              <h3 id={titleId} className="text-2xl font-bold text-gray-900 mb-4 tracking-tight">
                {step.title}
              </h3>
              
              <p id={descriptionId} className="text-[15px] text-text-secondary leading-relaxed">
                {step.description}
              </p>
            </div>

            {/* Footer / Controls */}
            <div className="flex shrink-0 items-center justify-between mt-5 pt-4 border-t border-gray-100">
              <button
                onClick={handlePrev}
                disabled={currentStep === 0}
                className={`min-h-11 px-2 text-sm font-medium transition-colors ${
                  currentStep === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Voltar
              </button>

              <button
                onClick={handleNext}
                className="flex items-center gap-2 bg-primary hover:bg-[#142C52] text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg hover:shadow-primary/20 active:scale-95"
              >
                {currentStep === STEPS.length - 1 ? 'Começar agora' : 'Próximo'}
                {currentStep !== STEPS.length - 1 && <ChevronRight className="w-4 h-4" />}
              </button>
            </div>

          </div>
        </div>
      </div>
    </dialog>
  );
}
