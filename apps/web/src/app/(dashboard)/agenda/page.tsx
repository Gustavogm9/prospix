'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, Badge, Input, toast } from '@prospix/ui';
import { Clock, Phone, Mail, Calendar, X, Plus, Info, Settings, RefreshCw, Lock } from 'lucide-react';
import { meetingsQueries, leadsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { apiFetch } from '@/lib/api-fetch';

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

interface LeadOption {
  id: string;
  name: string;
  company: string;
  whatsapp: string;
}

interface SelectedSlot {
  day: number;
  slot: string;
}

interface BusySlot {
  start: string;
  end: string;
  summary?: string;
  isProspixEvent?: boolean;
}

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  'LUNCH',
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

const STATUS_TO_API: Record<Meeting['status'], string> = {
  agendada: 'SCHEDULED',
  confirmada: 'CONFIRMED',
  aconteceu: 'HAPPENED',
  cancelada: 'CANCELLED',
};

const API_STATUS_TO_STATUS: Record<string, Meeting['status']> = {
  SCHEDULED: 'agendada',
  CONFIRMED: 'confirmada',
  HAPPENED: 'aconteceu',
  CANCELLED: 'cancelada',
};

const mapBackendMeeting = (meeting: any): Meeting => {
  const lead = meeting.leads || meeting.lead || {};
  const scheduledAt = meeting.scheduled_for || meeting.scheduledFor || meeting.scheduled_at || meeting.scheduledAt || meeting.start_at || meeting.startAt;
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const dayNum = scheduledDate ? scheduledDate.getDay() : NaN;
  const dayOfWeek = !isNaN(dayNum) ? Math.max(1, Math.min(5, dayNum)) : 1;
  const timeSlot = scheduledDate
    ? scheduledDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '09:00';

  return {
    id: meeting.id,
    leadName: lead.name || 'Sem lead',
    phone: lead.whatsapp || '',
    email: lead.email || '',
    company: lead.metadata?.cnpj_info?.nomeFantasia || lead.metadata?.cnpj_info?.razaoSocial || (lead.source_raw_data as any)?.name || lead.name || '',
    dayOfWeek,
    timeSlot,
    durationMin: meeting.duration_minutes || meeting.durationMinutes || 30,
    status: API_STATUS_TO_STATUS[meeting.status] || 'agendada',
  };
};

export default function Schedule() {
  const router = useRouter();
  const tenantId = useAuthStore(state => state.tenantId);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [busySlots, setBusySlots] = useState<BusySlot[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const getWeekMonday = (offset: number) => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
    const monday = new Date(now);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const weekMonday = getWeekMonday(weekOffset);

  const DAYS_OF_WEEK_WITH_DATES = DAYS_OF_WEEK.map((day, i) => {
    const date = new Date(weekMonday);
    date.setDate(date.getDate() + i);
    return {
      ...day,
      dateStr: date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }),
      fullDate: date,
      isToday: date.toDateString() === new Date().toDateString(),
    };
  });

  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [selectedMobileDay, setSelectedMobileDay] = useState<number>(1);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [isCreateMeetingOpen, setIsCreateMeetingOpen] = useState(false);
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingDuration, setMeetingDuration] = useState(30);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);

  // Check if a slot is blocked by a Google Calendar event
  const getBusyAtSlot = (day: number, slot: string) => {
    const [hours, minutes] = slot.split(':').map(Number);
    const slotDate = new Date(weekMonday);
    slotDate.setDate(slotDate.getDate() + (day - 1));
    slotDate.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    const slotEnd = new Date(slotDate.getTime() + 30 * 60000);

    return busySlots.find(b => {
      if (b.isProspixEvent) return false; // Don't double-block Prospix events
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return bStart < slotEnd && bEnd > slotDate;
    });
  };

  const getMeetingAtSlot = (day: number, slot: string) => {
    return meetings.find(m => m.dayOfWeek === day && m.timeSlot === slot);
  };

  const fetchMeetings = useCallback(async () => {
    if (!tenantId) return;
    try {
      const result = await meetingsQueries.list(tenantId);
      if (result.error) throw new Error(result.error.message);
      setMeetings((result.data || []).map(mapBackendMeeting));
    } catch (error) {
      console.error('Error fetching meetings:', error);
      setMeetings([]);
      toast.error('Erro de Conexão', 'Não foi possível carregar a agenda.');
    }
  }, [tenantId]);

  const syncGoogleCalendar = useCallback(async (silent = false) => {
    if (!silent) setIsSyncing(true);
    try {
      const res = await apiFetch('/api/integrations/calendar/sync', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        setBusySlots(json.events || []);
        if (!silent) toast.success('Sincronizado!', 'Google Calendar atualizado com sucesso.');
      }
    } catch (err) {
      console.error('Error syncing Google Calendar:', err);
      if (!silent) toast.error('Erro de Sync', 'Não foi possível sincronizar com o Google Calendar.');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Check calendar connection status on mount and auto-sync
  useEffect(() => {
    fetchMeetings();
    (async () => {
      try {
        const res = await apiFetch('/api/integrations/credentials');
        const json = await res.json();
        const connected = json?.data?.google?.calendarConnected ?? false;
        setCalendarConnected(connected);
        if (connected) {
          syncGoogleCalendar(true); // silent auto-sync
        }
      } catch {
        setCalendarConnected(false);
      }
    })();
  }, [fetchMeetings, syncGoogleCalendar]);

  const fetchLeadOptions = async () => {
    if (!tenantId) return;
    setIsLoadingLeads(true);
    try {
      const result = await leadsQueries.list(tenantId, { limit: 200 });
      if (result.error) throw new Error(result.error.message);
      const options = (result.data || []).map((lead: any) => ({
        id: lead.id,
        name: lead.name || 'Sem nome',
        company: lead.metadata?.cnpj_info?.nomeFantasia || lead.metadata?.cnpj_info?.razaoSocial || (lead.source_raw_data as any)?.name || lead.name || '',
        whatsapp: lead.whatsapp || '',
      }));
      setLeadOptions(options);
      setSelectedLeadId((current) => current || options[0]?.id || '');
    } catch (error) {
      console.error('Error fetching leads for meeting:', error);
      setLeadOptions([]);
      toast.error('Erro de Conexão', 'Não foi possível carregar leads para agendamento.');
    } finally {
      setIsLoadingLeads(false);
    }
  };

  const getSlotDate = (slot: SelectedSlot) => {
    const [rawHours, rawMinutes] = slot.slot.split(':').map(Number);
    const hours = rawHours ?? 9;
    const minutes = rawMinutes ?? 0;
    // Use weekMonday so the date matches the displayed week
    const date = new Date(weekMonday);
    date.setDate(date.getDate() + (slot.day - 1)); // day 1=Mon → +0, day 5=Fri → +4
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  const openCreateMeeting = async (day: number, slot: string) => {
    setSelectedSlot({ day, slot });
    setIsCreateMeetingOpen(true);
    if (leadOptions.length === 0) {
      await fetchLeadOptions();
    }
  };

  const handleCreateMeeting = async () => {
    if (!selectedSlot || !selectedLeadId || !tenantId) {
      toast.error('Lead obrigatório', 'Selecione um lead para criar a reunião.');
      return;
    }

    setIsCreatingMeeting(true);
    try {
      const result = await meetingsQueries.create(tenantId, {
        leadId: selectedLeadId,
        scheduledFor: getSlotDate(selectedSlot).toISOString(),
        durationMinutes: meetingDuration,
        location: meetingLocation.trim() || undefined,
      });
      if (result.error) throw new Error(result.error.message);

      // Push to Google Calendar if connected
      const meetingId = result.data?.id;
      if (calendarConnected && meetingId) {
        try {
          await apiFetch('/api/integrations/calendar/push-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meetingId }),
          });
        } catch (pushErr) {
          console.warn('Failed to push to Google Calendar:', pushErr);
          // Don't fail the meeting creation if push fails
        }
      }

      toast.success('Reunião agendada', calendarConnected ? 'Compromisso salvo e sincronizado com Google Calendar.' : 'Compromisso salvo com sucesso.');
      setIsCreateMeetingOpen(false);
      setSelectedSlot(null);
      setMeetingLocation('');
      setMeetingDuration(30);
      await fetchMeetings();
      if (calendarConnected) syncGoogleCalendar(true);
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message || 'Não foi possível criar a reunião no servidor.'
        : 'Não foi possível criar a reunião no servidor.';
      toast.error(
        'Erro ao agendar',
        message
      );
    } finally {
      setIsCreatingMeeting(false);
    }
  };

  const handleStatusChange = async (meetingId: string, newStatus: Meeting['status']) => {
    if (!tenantId) return;
    const previousMeetings = meetings;
    const previousSelectedMeeting = selectedMeeting;
    setMeetings(meetings.map(m => m.id === meetingId ? { ...m, status: newStatus } : m));
    if (selectedMeeting && selectedMeeting.id === meetingId) {
      setSelectedMeeting({ ...selectedMeeting, status: newStatus });
    }

    try {
      const result = await meetingsQueries.update(tenantId, meetingId, { status: STATUS_TO_API[newStatus] as any });
      if (result.error) throw new Error(result.error.message);

      // If cancelling, also remove from Google Calendar
      if (newStatus === 'cancelada' && calendarConnected) {
        try {
          await apiFetch('/api/integrations/calendar/cancel-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meetingId }),
          });
        } catch (cancelErr) {
          console.warn('Failed to cancel Google Calendar event:', cancelErr);
        }
      }
    } catch {
      setMeetings(previousMeetings);
      setSelectedMeeting(previousSelectedMeeting);
      toast.error('Erro de Conexão', 'Não foi possível confirmar a alteração no servidor.');
    }
  };

  return (
    <div className="space-y-4 flex flex-col h-full animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] shrink-0">
        <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Tudo aqui foi agendado pela IA</strong> e sincronizado com seu Google Calendar. Você recebe lembrete 1h antes. Após cada reunião, clique em <strong>"Marcar resultado"</strong> para a IA disparar follow-up e pedir indicações.</div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm shrink-0">
        <button onClick={() => setWeekOffset(0)} className={`h-8 px-3 rounded-md text-[12px] font-medium ${weekOffset === 0 ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Esta semana</button>
        <button onClick={() => setWeekOffset(1)} className={`h-8 px-3 rounded-md text-[12px] font-medium ${weekOffset === 1 ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Próxima semana</button>
        <button onClick={() => setWeekOffset(w => w > 0 ? w - 1 : 0)} className="h-8 w-8 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center justify-center">←</button>
        <button onClick={() => setWeekOffset(w => w + 1)} className="h-8 w-8 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center justify-center">→</button>
        <div className="w-px h-6 bg-[#E5E7EB] mx-1" />
        <button
          onClick={async () => {
            if (calendarConnected === false) {
              router.push('/configuracoes?tab=integracoes');
              return;
            }
            await syncGoogleCalendar();
          }}
          disabled={isSyncing}
          className={`h-8 px-3 rounded-md text-[12px] font-medium flex items-center gap-1.5 transition-all ${
            calendarConnected === false
              ? 'text-[#E8981C] border border-[#E8981C]/30 bg-[#FFF8F0] hover:bg-[#FFF1E0]'
              : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'
          }`}
        >
          {calendarConnected === false ? (
            <>
              <Settings className="w-3 h-3" />
              Configurar Google Calendar
            </>
          ) : (
            <>
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Sincronizando...' : 'Sync Google Calendar'}
            </>
          )}
        </button>
        <button
          onClick={() => router.push('/configuracoes?tab=agenda')}
          className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1.5 transition-all"
          title="Configurar horários disponíveis"
        >
          <Settings className="w-3 h-3" />
          Meus horários
        </button>
        <span className="ml-auto text-[11px] text-[#475569] flex items-center gap-1.5">
          <span className="w-[6px] h-[6px] rounded-full bg-[#039855] animate-pulse" />
          {meetings.length > 0 ? `${meetings.length} reuniões carregadas` : 'Nenhuma reunião'}
        </span>
      </div>

      {/* Mobile Day Selector Tabs */}
      <div className="flex md:hidden overflow-x-auto gap-1 p-1 bg-surface-sunken border border-border rounded-xl shrink-0">
        {DAYS_OF_WEEK_WITH_DATES.map(day => (
          <button
            key={day.value}
            onClick={() => setSelectedMobileDay(day.value)}
            className={`flex-1 text-center text-xs py-1.5 rounded-lg font-bold whitespace-nowrap transition-all ${
              selectedMobileDay === day.value ? 'bg-primary text-white shadow-sm' : day.isToday ? 'text-[#1B3A6B]' : 'text-text-secondary hover:text-text'
            }`}
          >
            <div>{day.label.split('-')[0]}</div>
            <div className={`text-[9px] mt-0.5 ${selectedMobileDay === day.value ? 'text-white/80' : 'text-text-secondary/60'} font-medium`}>{day.dateStr}</div>
          </button>
        ))}
      </div>

      {/* Grid container */}
      <Card className="bg-white border-border flex-1 overflow-hidden flex flex-col min-h-[500px] shadow-sm">
        {/* DESKTOP CALENDAR GRID */}
        <div className="hidden md:grid grid-cols-6 border-b border-border bg-surface-sunken/40 text-center text-xs font-semibold py-3 shrink-0">
          <div className="text-text-secondary/70 font-mono">Horário</div>
          {DAYS_OF_WEEK_WITH_DATES.map(day => (
            <div key={day.value} className="text-center">
              <div className={`text-[12px] font-semibold ${day.isToday ? 'text-[#1B3A6B]' : 'text-[#0F172A]'}`}>
                {day.label.split('-')[0]}
              </div>
              <div className={`text-[10px] mt-0.5 ${day.isToday ? 'text-[#1B3A6B] font-bold' : 'text-[#64748B]'}`}>
                {day.dateStr}
              </div>
            </div>
          ))}
        </div>

        {/* Table/Grid Body Scrollable - Desktop */}
        <div className="hidden md:flex flex-col flex-1 overflow-y-auto divide-y divide-border/60 select-none">
          {TIME_SLOTS.map((slot) => (
            slot === 'LUNCH' ? (
              <div key="lunch" className="grid grid-cols-6 items-center min-h-[32px] bg-[#F9FAFB] border-y border-[#EEF0F3]">
                <div className="flex items-center justify-center text-[10px] text-[#64748B] font-medium">☕</div>
                <div className="col-span-5 text-center text-[10px] text-[#64748B] italic">Almoço · 12:00 – 13:30</div>
              </div>
            ) : (
            <div key={slot} className="grid grid-cols-6 items-stretch min-h-[46px] divide-x divide-border/30">
              <div className="flex items-center justify-center text-[10px] text-text-secondary/70 font-mono font-medium py-2">
                {slot}
              </div>

              {[1, 2, 3, 4, 5].map((dayValue) => {
                const meeting = getMeetingAtSlot(dayValue, slot);
                const busy = getBusyAtSlot(dayValue, slot);
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
                    ) : busy ? (
                      <div
                        className="w-full rounded-lg border border-dashed border-[#CBD5E1] bg-[#F1F5F9] flex items-center justify-center gap-1 cursor-default"
                        title={busy.summary || 'Horário ocupado no Google Calendar'}
                      >
                        <Lock className="w-3 h-3 text-[#94A3B8]" />
                        <span className="text-[9px] text-[#94A3B8] font-medium truncate max-w-[80%]">
                          {busy.summary || 'Ocupado'}
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={() => openCreateMeeting(dayValue, slot)}
                        className="w-full h-full rounded-lg border border-transparent transition-all flex items-center justify-center hover:bg-surface-sunken hover:border-border/80 group"
                      >
                        <span className="text-[10px] text-text-secondary opacity-0 group-hover:opacity-100 font-bold flex items-center gap-1">
                          <Plus className="w-3 h-3" />
                          Agendar
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            )
          ))}
        </div>

        {/* MOBILE LIST AGENDA VIEW */}
        <div className="flex flex-col md:hidden flex-1 overflow-y-auto divide-y divide-border/60">
          {TIME_SLOTS.map((slot) => {
            if (slot === 'LUNCH') {
              return (
                <div key="lunch-mobile" className="flex items-center gap-4 p-3 bg-[#F9FAFB] border-y border-[#EEF0F3]">
                  <div className="text-xs font-mono font-bold text-[#64748B] w-12 shrink-0">☕</div>
                  <div className="flex-1 text-[10px] text-[#64748B] italic">Almoço · 12:00 – 13:30</div>
                </div>
              );
            }
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
                    <button
                      onClick={() => openCreateMeeting(selectedMobileDay, slot)}
                      className="text-[10px] text-text-secondary/70 py-2 px-3 rounded-lg border border-dashed border-border hover:bg-surface-sunken hover:text-text transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Agendar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {isCreateMeetingOpen && selectedSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-border rounded-2xl w-full max-w-[500px] p-6 space-y-5 shadow-2xl animate-scaleIn">
            <div className="flex justify-between items-start">
              <div className="flex gap-3">
                <div className="p-3 bg-primary-soft border border-primary/20 text-primary rounded-xl">
                  <Calendar className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold font-heading text-text">Agendar reunião</h3>
                  <p className="text-xs text-text-secondary leading-none mt-1">
                    {DAYS_OF_WEEK.find(day => day.value === selectedSlot.day)?.label} às {selectedSlot.slot}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateMeetingOpen(false)}
                className="p-1 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text transition-colors"
                aria-label="Fechar agendamento"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Lead</span>
                <select
                  value={selectedLeadId}
                  onChange={(event) => setSelectedLeadId(event.target.value)}
                  disabled={isLoadingLeads}
                  className="w-full bg-white border border-border text-xs rounded-xl px-3 h-10 text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none disabled:opacity-60"
                >
                  {isLoadingLeads ? (
                    <option>Carregando leads...</option>
                  ) : leadOptions.length > 0 ? (
                    leadOptions.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name} - {lead.company}
                      </option>
                    ))
                  ) : (
                    <option value="">Nenhum lead disponível</option>
                  )}
                </select>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Duração</span>
                  <select
                    value={meetingDuration}
                    onChange={(event) => setMeetingDuration(Number(event.target.value))}
                    className="w-full bg-white border border-border text-xs rounded-xl px-3 h-10 text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  >
                    <option value={30}>30 minutos</option>
                    <option value={45}>45 minutos</option>
                    <option value={60}>60 minutos</option>
                    <option value={90}>90 minutos</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Local</span>
                  <Input
                    value={meetingLocation}
                    onChange={(event) => setMeetingLocation(event.target.value)}
                    placeholder="Meet, telefone ou endereço"
                    className="h-10 text-xs"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                onClick={() => setIsCreateMeetingOpen(false)}
                className="bg-surface-sunken hover:bg-border text-text border border-border/80 text-xs font-semibold h-10 rounded-xl px-4"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreateMeeting}
                disabled={isCreatingMeeting || isLoadingLeads || !selectedLeadId}
                className="bg-primary hover:bg-primary-hover text-white text-xs font-semibold h-10 rounded-xl px-4 disabled:opacity-50"
              >
                {isCreatingMeeting ? 'Agendando...' : 'Agendar'}
              </Button>
            </div>
          </div>
        </div>
      )}

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
                aria-label="Fechar detalhes da reunião"
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
