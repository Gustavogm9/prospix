import { useState } from 'react';
import { Card, Button, Badge } from '@prospix/ui';
import { Clock, Phone, Mail, Calendar, X } from 'lucide-react';
import { apiClient } from '../lib/api-client';

interface Meeting {
  id: string;
  leadName: string;
  phone: string;
  email: string;
  company: string;
  dayOfWeek: number; // 1 = Seg, 2 = Ter, 3 = Qua, 4 = Qui, 5 = Sex
  timeSlot: string; // "09:00", "10:30", etc.
  durationMin: number;
  status: 'agendada' | 'confirmada' | 'aconteceu' | 'cancelada';
}

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'
];

const DAYS_OF_WEEK = [
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
];

const STATUS_CONFIG = {
  agendada: { bg: 'bg-primary-soft text-primary border-primary/20', name: 'Agendada' },
  confirmada: { bg: 'bg-success-soft text-success-text border-success/20', name: 'Confirmada' },
  aconteceu: { bg: 'bg-surface-sunken border-border text-text-secondary', name: 'Concluída' },
  cancelada: { bg: 'bg-red-50 text-red-600 border-red-200', name: 'Cancelada' },
};

export default function Schedule() {
  const [meetings, setMeetings] = useState<Meeting[]>([
    { id: '1', leadName: 'Marcos de Oliveira', phone: '+55 11 98888-7777', email: 'marcos@oliveira.com.br', company: 'Oliveira Consultoria', dayOfWeek: 2, timeSlot: '14:30', durationMin: 30, status: 'confirmada' },
    { id: '2', leadName: 'Ana Beatriz Reis', phone: '+55 21 97777-6666', email: 'ana@reis.com.br', company: 'Reis Arquitetura', dayOfWeek: 3, timeSlot: '10:00', durationMin: 60, status: 'agendada' },
    { id: '3', leadName: 'Metalúrgica Alfa', phone: '+55 19 96666-5555', email: 'vendas@alfa.com.br', company: 'Alfa Ltda', dayOfWeek: 1, timeSlot: '09:00', durationMin: 30, status: 'aconteceu' },
    { id: '4', leadName: 'Julia Silveira', phone: '+55 31 95555-4444', email: 'julia@silveira.med.br', company: 'Clinica Silveira', dayOfWeek: 4, timeSlot: '16:00', durationMin: 30, status: 'cancelada' },
  ]);

  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [selectedMobileDay, setSelectedMobileDay] = useState<number>(1);

  const getMeetingAtSlot = (day: number, slot: string) => {
    return meetings.find(m => m.dayOfWeek === day && m.timeSlot === slot);
  };

  const handleStatusChange = async (meetingId: string, newStatus: Meeting['status']) => {
    setMeetings(meetings.map(m => m.id === meetingId ? { ...m, status: newStatus } : m));
    if (selectedMeeting && selectedMeeting.id === meetingId) {
      setSelectedMeeting({ ...selectedMeeting, status: newStatus });
    }

    try {
      await apiClient.patch(`/meetings/${meetingId}`, { status: newStatus });
    } catch {
      // silent fallback
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full animate-fadeIn">
      {/* Header Schedule */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Agenda Semanal</h2>
          <p className="text-text-secondary text-sm mt-1">
            Controle de compromissos integrados ao Google Agenda com detecção automática de conflitos.
          </p>
        </div>
      </div>

      {/* Mobile Day Selector Tabs */}
      <div className="flex md:hidden overflow-x-auto gap-1 p-1 bg-surface-sunken border border-border rounded-xl shrink-0">
        {DAYS_OF_WEEK.map(day => (
          <button
            key={day.value}
            onClick={() => setSelectedMobileDay(day.value)}
            className={`flex-1 text-center text-xs py-2 rounded-lg font-bold whitespace-nowrap transition-all ${
              selectedMobileDay === day.value ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text'
            }`}
          >
            {day.label.split('-')[0]}
          </button>
        ))}
      </div>

      {/* Grid container */}
      <Card className="bg-white border-border flex-1 overflow-hidden flex flex-col min-h-[500px] shadow-sm">
        {/* DESKTOP CALENDAR GRID */}
        <div className="hidden md:grid grid-cols-6 border-b border-border bg-surface-sunken/40 text-center text-xs font-semibold py-3 shrink-0">
          <div className="text-text-secondary/70 font-mono">Horário</div>
          {DAYS_OF_WEEK.map(day => (
            <div key={day.value} className="text-text">
              {day.label}
            </div>
          ))}
        </div>

        {/* Table/Grid Body Scrollable - Desktop */}
        <div className="hidden md:flex flex-col flex-1 overflow-y-auto divide-y divide-border/60 select-none">
          {TIME_SLOTS.map((slot) => (
            <div key={slot} className="grid grid-cols-6 items-stretch min-h-[46px] divide-x divide-border/30">
              <div className="flex items-center justify-center text-[10px] text-text-secondary/70 font-mono font-medium py-2">
                {slot}
              </div>

              {[1, 2, 3, 4, 5].map((dayValue) => {
                const meeting = getMeetingAtSlot(dayValue, slot);
                return (
                  <div
                    key={dayValue}
                    className="p-1 min-h-full flex items-stretch relative"
                  >
                    {meeting ? (
                      <button
                        onClick={() => setSelectedMeeting(meeting)}
                        className={`w-full rounded-lg border text-left p-2 transition-all flex flex-col justify-between ${
                          STATUS_CONFIG[meeting.status].bg
                        } hover:scale-[1.02] shadow-sm`}
                      >
                        <span className="text-[10px] font-bold leading-none truncate block">
                          {meeting.leadName}
                        </span>
                        <span className="text-[9px] truncate opacity-80 mt-1 block">
                          {meeting.company}
                        </span>
                      </button>
                    ) : (
                      <div className="w-full h-full rounded-lg hover:bg-surface-sunken border border-transparent hover:border-border/80 transition-all cursor-pointer flex items-center justify-center group">
                        <span className="text-[10px] text-text-secondary opacity-0 group-hover:opacity-100 font-bold">
                          + Agendar
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* MOBILE LIST AGENDA VIEW */}
        <div className="flex flex-col md:hidden flex-1 overflow-y-auto divide-y divide-border/60">
          {TIME_SLOTS.map((slot) => {
            const meeting = getMeetingAtSlot(selectedMobileDay, slot);
            return (
              <div key={slot} className="flex items-center gap-4 p-3 hover:bg-surface-sunken/40 transition-colors">
                <div className="text-xs font-mono font-bold text-text-secondary/80 w-12 shrink-0">
                  {slot}
                </div>
                <div className="flex-1">
                  {meeting ? (
                    <button
                      onClick={() => setSelectedMeeting(meeting)}
                      className={`w-full rounded-xl border text-left p-3.5 transition-all flex flex-col justify-between ${
                        STATUS_CONFIG[meeting.status].bg
                      } hover:scale-[1.01] shadow-sm`}
                    >
                      <div className="flex justify-between items-start w-full">
                        <span className="text-xs font-bold leading-none truncate block">
                          {meeting.leadName}
                        </span>
                        <Badge className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${STATUS_CONFIG[meeting.status].bg}`}>
                          {STATUS_CONFIG[meeting.status].name}
                        </Badge>
                      </div>
                      <span className="text-[10px] mt-1.5 block opacity-95">
                        {meeting.company}
                      </span>
                    </button>
                  ) : (
                    <div className="text-[10px] text-text-secondary/40 py-2 italic">
                      Sem compromissos
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Meeting Detail Modal */}
      {selectedMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-border rounded-2xl w-full max-w-[460px] p-6 space-y-6 shadow-2xl animate-scaleIn">
            <div className="flex justify-between items-start">
              <div className="flex gap-3">
                <div className="p-3 bg-primary-soft border border-primary/20 text-primary rounded-xl">
                  <Calendar className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-text">{selectedMeeting.leadName}</h3>
                  <p className="text-xs text-text-secondary leading-none mt-0.5">{selectedMeeting.company}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedMeeting(null)}
                className="p-1 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-sunken p-3.5 border border-border rounded-xl space-y-1">
                  <span className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider block">Horário</span>
                  <div className="flex items-center gap-2 text-xs font-mono font-medium text-text">
                    <Clock className="w-3.5 h-3.5 text-primary" />
                    <span>{selectedMeeting.timeSlot} ({selectedMeeting.durationMin}min)</span>
                  </div>
                </div>

                <div className="bg-surface-sunken p-3.5 border border-border rounded-xl space-y-1">
                  <span className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider block">Status</span>
                  <Badge className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 border ${
                    STATUS_CONFIG[selectedMeeting.status].bg
                  }`}>
                    {STATUS_CONFIG[selectedMeeting.status].name}
                  </Badge>
                </div>
              </div>

              <div className="bg-surface-sunken p-4 border border-border rounded-xl space-y-2.5">
                <span className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider block">Contato do Lead</span>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2.5 text-text">
                    <Phone className="w-3.5 h-3.5 text-text-secondary/70 font-mono" />
                    <span className="font-mono">{selectedMeeting.phone}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-text">
                    <Mail className="w-3.5 h-3.5 text-text-secondary/70" />
                    <span className="truncate">{selectedMeeting.email}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions / Status Updates */}
            <div className="space-y-2.5">
              <span className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider block">Alterar Status do Compromisso</span>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  onClick={() => handleStatusChange(selectedMeeting.id, 'confirmada')}
                  className="bg-success hover:bg-success/90 text-white text-[10px] font-bold py-2 rounded-xl transition-all h-9"
                >
                  Confirmar
                </Button>
                <Button
                  onClick={() => handleStatusChange(selectedMeeting.id, 'aconteceu')}
                  className="bg-surface-sunken hover:bg-border text-text border border-border/80 text-[10px] font-bold py-2 rounded-xl transition-all h-9"
                >
                  Concluir
                </Button>
                <Button
                  onClick={() => handleStatusChange(selectedMeeting.id, 'cancelada')}
                  className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-[10px] font-bold py-2 rounded-xl transition-all h-9"
                >
                  Cancelar
                </Button>
              </div>
            </div>

            {/* Close Button */}
            <Button
              onClick={() => setSelectedMeeting(null)}
              className="w-full bg-surface-sunken hover:bg-border text-text border border-border/80 font-semibold h-11 rounded-xl transition-all"
            >
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
