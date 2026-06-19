'use client';

import { useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  NodeProps,
  EdgeProps,
  Edge,
  Node,
  Connection,
  BaseEdge,
  getBezierPath,
  EdgeLabelRenderer
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Zap, Clock, MessageSquare, Play, GitBranch, Calendar, CheckCircle2, Trash2 } from 'lucide-react';
import { toast } from '@prospix/ui';

// ── Custom Nodes ──────────────────────────────────────────────────────────

const TriggerNode = ({ data }: NodeProps) => {
  return (
    <div className="bg-white border-2 border-orange-400 rounded-xl shadow-md w-[400px]">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-gray-500" />
          <span className="font-bold text-[15px] text-gray-900">{data.title as string}</span>
          <span className="text-[10px] font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full ml-2">GATILHO</span>
        </div>
      </div>
      <div className="p-5 text-[13px] text-gray-600 font-medium">
        <p className="mb-4">Quando lead novo entra na fila com WhatsApp válido, perfil ativo e fit score ≥ 7.</p>
        <div className="flex gap-2">
          <span className="flex items-center gap-1 text-[11px] bg-red-50 text-red-600 px-2 py-1 rounded-md">📍 SJRP</span>
          <span className="flex items-center gap-1 text-[11px] bg-purple-50 text-purple-600 px-2 py-1 rounded-md">👩‍⚕️ Médicos</span>
          <span className="flex items-center gap-1 text-[11px] bg-yellow-50 text-yellow-600 px-2 py-1 rounded-md">⭐ Fit ≥ 7</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-orange-400 bg-white" />
    </div>
  );
};

const WaitNode = ({ data }: NodeProps) => {
  const onChange = data.onChange as (newData: any) => void;
  const onDelete = data.onDelete as () => void;
  const isDeletable = data.isDeletable as boolean;
  const title = (data.title as string) || 'Aguardar';
  const content = (data.content as string) || '';

  return (
    <div className="bg-white border-2 border-gray-300 rounded-xl shadow-md w-[400px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-gray-300 bg-white" />
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-500" />
          <input 
            type="text" 
            value={title} 
            onChange={(e) => onChange({ title: e.target.value })}
            className="font-bold text-[14px] text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-gray-400 outline-none px-1"
          />
          <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full ml-2">ESPERA</span>
        </div>
        {isDeletable && (
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="p-4">
        <input 
          type="text" 
          value={content} 
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="Ex: Aguardar 1 dia - se não responder, dispara follow-up"
          className="w-full h-9 border border-gray-200 rounded-lg px-3 text-[13px] text-gray-700 focus:border-gray-400 outline-none"
        />
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-gray-300 bg-white" />
    </div>
  );
};

const SendNode = ({ data }: NodeProps) => {
  const onChange = data.onChange as (newData: any) => void;
  const onDelete = data.onDelete as () => void;
  const isDeletable = data.isDeletable as boolean;
  const message = (data.message as string) || '';
  const title = (data.title as string) || 'Mensagem';

  const insertVariable = (variable: string) => {
    onChange({ message: message + variable });
  };

  return (
    <div className="bg-white border-2 border-[#1B3A6B] rounded-xl shadow-md w-[400px] overflow-hidden">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-[#1B3A6B] bg-white" />
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-[#1B3A6B]/5">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#1B3A6B]" />
          <input 
            type="text" 
            value={title} 
            onChange={(e) => onChange({ title: e.target.value })}
            className="font-bold text-[14px] text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-[#1B3A6B] outline-none px-1"
          />
          <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full ml-2">ENVIO</span>
        </div>
        {isDeletable && (
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="p-5 space-y-3">
        <textarea
          value={message}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder="Digite a mensagem que a IA enviará..."
          rows={3}
          className="w-full bg-[#F3EFE9] p-3 rounded-xl text-[13px] text-gray-700 italic border border-gray-200 focus:border-[#1B3A6B] outline-none resize-y"
        />
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[11px] text-gray-400 mr-1 font-bold">Variáveis:</span>
          {['{Nome}', '{Empresa}', '{Cidade}', '{Quebra-gelo}'].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVariable(v)}
              className="text-[10px] font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded-md transition-colors border border-gray-200"
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-[#1B3A6B] bg-white" />
    </div>
  );
};

const DecisionNode = ({ data }: NodeProps) => {
  const onChange = data.onChange as (newData: any) => void;
  const onDelete = data.onDelete as () => void;
  const isDeletable = data.isDeletable as boolean;
  const title = (data.title as string) || 'Classificar intenção';
  
  const positiveLabel = (data.positiveLabel as string) || 'INTERESSADO';
  const negativeLabel = (data.negativeLabel as string) || 'OBJEÇÃO / SEM INTERESSE';

  return (
    <div className="bg-white border-2 border-orange-400 rounded-xl shadow-md w-[450px] relative">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-orange-400 bg-white" />
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-orange-50">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-orange-500" />
          <input 
            type="text" 
            value={title} 
            onChange={(e) => onChange({ title: e.target.value })}
            className="font-bold text-[14px] text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-orange-400 outline-none px-1"
          />
          <span className="text-[10px] font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full ml-2">DECISÃO</span>
        </div>
        {isDeletable && (
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      
      <div className="p-4 grid grid-cols-2 gap-4 divide-x divide-gray-100">
        {/* Positive Output Column */}
        <div className="space-y-2 relative pb-4 text-center">
          <div className="flex items-center gap-1.5 justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="text-[11px] font-bold text-gray-500 uppercase">Resposta Positiva</span>
          </div>
          <input 
            type="text" 
            value={positiveLabel} 
            onChange={(e) => onChange({ positiveLabel: e.target.value })}
            placeholder="Ex: interessado, quer saber mais"
            className="w-full h-8 border border-gray-200 rounded-lg px-2.5 text-[12px] text-gray-700 focus:border-green-400 outline-none"
          />
          {/* Handle positioned bottom-left inside column */}
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2">
            <Handle 
              type="source" 
              position={Position.Bottom} 
              id="positive" 
              className="w-3.5 h-3.5 border-2 border-green-500 bg-white" 
            />
            <span className="text-[9px] font-bold text-green-600 block text-center mt-1">POS</span>
          </div>
        </div>

        {/* Negative Output Column */}
        <div className="space-y-2 pl-4 relative pb-4 text-center">
          <div className="flex items-center gap-1.5 justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="text-[11px] font-bold text-gray-500 uppercase">Resposta Negativa</span>
          </div>
          <input 
            type="text" 
            value={negativeLabel} 
            onChange={(e) => onChange({ negativeLabel: e.target.value })}
            placeholder="Ex: sem interesse, já tenho"
            className="w-full h-8 border border-gray-200 rounded-lg px-2.5 text-[12px] text-gray-700 focus:border-red-400 outline-none"
          />
          {/* Handle positioned bottom-right inside column */}
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2">
            <Handle 
              type="source" 
              position={Position.Bottom} 
              id="negative" 
              className="w-3.5 h-3.5 border-2 border-red-500 bg-white" 
            />
            <span className="text-[9px] font-bold text-red-600 block text-center mt-1">NEG</span>
          </div>
        </div>
      </div>
      <div className="h-4" /> {/* Spacer for Handles labels */}
    </div>
  );
};

const ActionNode = ({ data }: NodeProps) => {
  const onChange = data.onChange as (newData: any) => void;
  const onDelete = data.onDelete as () => void;
  const isDeletable = data.isDeletable as boolean;
  const title = (data.title as string) || 'Ação';
  const content = (data.content as string) || '';

  return (
    <div className="bg-white border-2 border-green-500 rounded-xl shadow-md w-[400px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-green-500 bg-white" />
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-green-50">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-green-600" />
          <input 
            type="text" 
            value={title} 
            onChange={(e) => onChange({ title: e.target.value })}
            className="font-bold text-[14px] text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-green-400 outline-none px-1"
          />
          <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full ml-2">AÇÃO</span>
        </div>
        {isDeletable && (
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="p-4">
        <input 
          type="text" 
          value={content} 
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="Ex: Propor reunião 15min ou Enviar apresentação PDF"
          className="w-full h-9 border border-gray-200 rounded-lg px-3 text-[13px] text-gray-700 focus:border-green-500 outline-none"
        />
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-green-500 bg-white" />
    </div>
  );
};

const FinalNode = ({ data }: NodeProps) => (
  <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl shadow-sm w-[400px] flex flex-col items-center justify-center p-5">
    <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-[#E5E7EB] bg-white" />
    <div className="flex items-center gap-2 mb-2">
      <CheckCircle2 className="w-5 h-5 text-green-500" />
      <span className="font-bold text-[15px] text-gray-900">{data.title as string || 'Reunião agendada - fluxo completo'}</span>
      <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full ml-2">FINAL</span>
    </div>
    <div className="text-[12px] font-bold text-gray-400 flex items-center gap-2">
      <span>Fluxo Finalizado com Sucesso</span>
    </div>
  </div>
);

const nodeTypes = {
  trigger: TriggerNode,
  wait: WaitNode,
  send: SendNode,
  decision: DecisionNode,
  action: ActionNode,
  final: FinalNode,
};

const CustomEdge = ({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data }: EdgeProps) => {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const label = data?.label as string | undefined;
  const variant = data?.variant as string | undefined;
  const onDeleteEdge = data?.onDeleteEdge as (() => void) | undefined;

  return (
    <>
      <BaseEdge path={edgePath} style={{ stroke: '#CBD5E1', strokeWidth: 2 }} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan flex items-center gap-1 bg-white px-3 py-1.5 rounded-full border shadow-sm"
          >
            <span className={`text-[11px] font-bold uppercase ${
              variant === 'positive' ? 'text-green-600' : 'text-red-500'
            }`}>
              {label}
            </span>
            {onDeleteEdge && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEdge();
                }} 
                className="w-3.5 h-3.5 rounded-full bg-gray-100 hover:bg-red-500 hover:text-white flex items-center justify-center text-gray-400 text-[9px] font-bold transition-all ml-1.5"
                title="Remover conexão"
              >
                ×
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            {onDeleteEdge && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEdge();
                }} 
                className="w-5 h-5 rounded-full bg-white border border-gray-200 hover:bg-red-500 hover:text-white flex items-center justify-center text-gray-400 hover:border-red-500 text-[10px] font-bold shadow-sm transition-all"
                title="Remover conexão"
              >
                ×
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

const edgeTypes = {
  custom: CustomEdge,
};

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'trigger',
    position: { x: 300, y: 50 },
    data: { 
      title: 'Lead capturado'
    },
  },
  {
    id: '2',
    type: 'wait',
    position: { x: 300, y: 300 },
    data: { title: 'Aguardar horário ideal', content: 'Envia entre 9h-12h ou 14h-17h - respeita fuso e dia útil' },
  },
  {
    id: '3',
    type: 'send',
    position: { x: 300, y: 480 },
    data: { 
      title: 'Mensagem inicial', 
      message: 'Oi Dr. {Nome}, tudo bem? Aqui é o Giovane, corretor da MetLife em SJRP. Trabalho com proteção de renda pra médicos que dependem da própria atuação. Posso te explicar em 30s como funciona?'
    },
  },
  {
    id: '4',
    type: 'wait',
    position: { x: 300, y: 780 },
    data: { title: 'Aguardar resposta', content: 'Até 3 dias - se não responder, dispara follow-up' },
  },
  {
    id: '5',
    type: 'decision',
    position: { x: 300, y: 960 },
    data: { title: 'Classificar intenção', positiveLabel: 'INTERESSADO', negativeLabel: 'JÁ TEM SEGURO' },
  },
  {
    id: '6',
    type: 'send',
    position: { x: 50, y: 1180 },
    data: { title: 'Apresentar 3 coberturas', message: 'Doença grave - cirurgia - diárias DIH' },
  },
  {
    id: '7',
    type: 'action',
    position: { x: 50, y: 1400 },
    data: { title: 'Propor reunião', content: 'Oferece 2 horários - agenda no Calendar se aceitar' },
  },
  {
    id: '8',
    type: 'send',
    position: { x: 550, y: 1180 },
    data: { title: 'Diferenciador MetLife', message: 'Maioria cobre só morte. O nosso protege renda também...' },
  },
  {
    id: '9',
    type: 'decision',
    position: { x: 550, y: 1400 },
    data: { title: 'Continuou?', positiveLabel: 'SIM', negativeLabel: 'NÃO' },
  },
  {
    id: '10',
    type: 'final',
    position: { x: 200, y: 1650 },
    data: { title: 'Reunião agendada - fluxo completo' },
  }
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', type: 'custom' },
  { id: 'e2-3', source: '2', target: '3', type: 'custom' },
  { id: 'e3-4', source: '3', target: '4', type: 'custom' },
  { id: 'e4-5', source: '4', target: '5', type: 'custom' },
  { id: 'e5-6', source: '5', target: '6', type: 'custom', sourceHandle: 'positive' },
  { id: 'e5-8', source: '5', target: '8', type: 'custom', sourceHandle: 'negative' },
  { id: 'e6-7', source: '6', target: '7', type: 'custom' },
  { id: 'e8-9', source: '8', target: '9', type: 'custom' },
  { id: 'e7-10', source: '7', target: '10', type: 'custom' },
  { id: 'e9-10', source: '9', target: '10', type: 'custom', sourceHandle: 'positive' }
];

export function ScriptFlowBuilder({ 
  initialNodesProp, 
  initialEdgesProp, 
  onSave, 
  isSaving 
}: { 
  initialNodesProp?: Node[], 
  initialEdgesProp?: Edge[], 
  onSave?: (flow: { nodes: Node[], edges: Edge[] }) => void,
  isSaving?: boolean 
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodesProp?.length ? initialNodesProp : initialNodes);
  const initialSanitizedEdges = (() => {
    const rawEdges = initialEdgesProp?.length ? initialEdgesProp : initialEdges;
    const activeNodes = initialNodesProp?.length ? initialNodesProp : initialNodes;
    
    return rawEdges.map(edge => {
      const sourceNode = activeNodes.find(n => n.id === edge.source);
      if (sourceNode && sourceNode.type === 'decision') {
        let sourceHandle = edge.sourceHandle;
        if (!sourceHandle) {
          if (edge.data?.variant === 'positive') {
            sourceHandle = 'positive';
          } else if (edge.data?.variant === 'negative') {
            sourceHandle = 'negative';
          } else if (edge.source === '5' && edge.target === '6') {
            sourceHandle = 'positive';
          } else if (edge.source === '5' && edge.target === '8') {
            sourceHandle = 'negative';
          } else if (edge.source === '9' && edge.target === '10') {
            sourceHandle = 'positive';
          } else {
            // Fallback de posição no canvas
            const targetNode = activeNodes.find(n => n.id === edge.target);
            if (targetNode && targetNode.position.x < sourceNode.position.x) {
              sourceHandle = 'positive';
            } else {
              sourceHandle = 'negative';
            }
          }
        }
        return { ...edge, sourceHandle };
      }
      return edge;
    });
  })();

  const [edges, setEdges, onEdgesChange] = useEdgesState(initialSanitizedEdges);

  const updateNodeData = useCallback((id: string, newData: any) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              ...newData,
            },
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }, [setNodes, setEdges]);

  const deleteEdge = useCallback((id: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== id));
  }, [setEdges]);

  const addNode = (type: 'send' | 'wait' | 'decision' | 'action') => {
    const id = `node_${Date.now()}`;
    const position = {
      x: 300 + (Math.random() - 0.5) * 150,
      y: 400 + (Math.random() - 0.5) * 150
    };

    let data: any = { title: '' };
    if (type === 'send') {
      data = { title: 'Nova Mensagem', message: '' };
    } else if (type === 'wait') {
      data = { title: 'Aguardar', content: '' };
    } else if (type === 'decision') {
      data = { title: 'Classificar Intenção', positiveLabel: 'INTERESSADO', negativeLabel: 'SEM INTERESSE' };
    } else if (type === 'action') {
      data = { title: 'Nova Ação', content: '' };
    }

    const newNode: Node = {
      id,
      type,
      position,
      data
    };

    setNodes((nds) => [...nds, newNode]);
  };

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, type: 'custom' } as Edge, eds)),
    [setEdges],
  );

  const handleSave = () => {
    const triggerNode = nodes.find((n) => n.type === 'trigger');
    const finalNode = nodes.find((n) => n.type === 'final');

    if (!triggerNode || !finalNode) {
      toast.error('Erro de validação', 'Nó de gatilho ou final não encontrado.');
      return;
    }

    // 1. Validar alcançabilidade de todos os nós a partir do Gatilho usando DFS
    const getReachableNodes = (startId: string): Set<string> => {
      const visited = new Set<string>();
      const dfs = (currentId: string) => {
        visited.add(currentId);
        const neighbors = edges
          .filter((edge) => edge.source === currentId)
          .map((edge) => edge.target);
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            dfs(neighbor);
          }
        }
      };
      dfs(startId);
      return visited;
    };

    const reachable = getReachableNodes(triggerNode.id);

    // Verificar se há algum nó no canvas que não é alcançável a partir do trigger
    const unreachableNode = nodes.find((node) => !reachable.has(node.id));

    if (unreachableNode) {
      toast.error(
        'Erro de validação', 
        `A caixa "${unreachableNode.data?.title || unreachableNode.type}" está desconectada do fluxo principal. Conecte-a ou remova-a para salvar.`
      );
      return;
    }

    // 2. Validar que existe pelo menos uma rota contínua ligando o Gatilho ao nó Final
    if (!reachable.has(finalNode.id)) {
      toast.error(
        'Erro de validação', 
        'O fluxo de conversa deve obrigatoriamente começar em "Lead capturado" e terminar na caixa "Reunião agendada - fluxo completo".'
      );
      return;
    }

    if (onSave) {
      const sanitizedNodes = nodes.map(node => {
        if (node.type === 'trigger' && node.data && typeof node.data.content !== 'string') {
          return {
            ...node,
            data: {
              ...node.data,
              content: '[GATILHO_MEDICO_ESTATICO]'
            }
          };
        }
        return node;
      });
      onSave({ nodes: sanitizedNodes, edges });
    }
  };

  // Injetar callbacks de mudança e remoção no data dos nós
  const nodesWithCallbacks = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onChange: (newData: any) => updateNodeData(node.id, newData),
      onDelete: () => deleteNode(node.id),
      isDeletable: node.type !== 'trigger' && node.type !== 'final',
    },
  }));

  // Adicionar rótulos dinâmicos baseados no nó de Decisão de origem
  const edgesWithLabels = edges.map((edge) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (sourceNode && sourceNode.type === 'decision') {
      const isPositive = edge.sourceHandle === 'positive' || edge.data?.variant === 'positive';
      const label = isPositive 
        ? (sourceNode.data?.positiveLabel as string || 'POSITIVO')
        : (sourceNode.data?.negativeLabel as string || 'NEGATIVO');
      return {
        ...edge,
        data: {
          ...edge.data,
          label: label.toUpperCase(),
          variant: isPositive ? 'positive' : 'negative'
        }
      };
    }
    return edge;
  });

  const edgesWithCallbacks = edgesWithLabels.map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      onDeleteEdge: () => deleteEdge(edge.id),
    },
  }));

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] flex flex-col h-[700px] overflow-hidden shadow-sm relative">
      <div className="p-5 border-b border-[#F1F3F6] flex flex-col sm:flex-row sm:items-center justify-between z-10 bg-white gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
            <Play className="w-5 h-5 text-[#1B3A6B]" />
            Fluxo da Conversa
          </h2>
          <p className="text-[13px] text-[#64748B] mt-1">
            Conecte as caixas para desenhar o roteiro. Clique em "+" para adicionar blocos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => addNode('send')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#1B3A6B] hover:bg-[#1B3A6B]/5 text-[#1B3A6B] rounded-lg text-[12px] font-bold transition-all shadow-sm"
          >
            <MessageSquare className="w-3.5 h-3.5" /> + Mensagem
          </button>
          <button
            onClick={() => addNode('wait')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 rounded-lg text-[12px] font-bold transition-all shadow-sm"
          >
            <Clock className="w-3.5 h-3.5" /> + Espera
          </button>
          <button
            onClick={() => addNode('decision')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-orange-400 hover:bg-orange-50 text-orange-600 rounded-lg text-[12px] font-bold transition-all shadow-sm"
          >
            <GitBranch className="w-3.5 h-3.5" /> + Decisão
          </button>
          <button
            onClick={() => addNode('action')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-green-500 hover:bg-green-50 text-green-600 rounded-lg text-[12px] font-bold transition-all shadow-sm"
          >
            <Calendar className="w-3.5 h-3.5" /> + Ação
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1 hidden sm:block" />
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#1B3A6B] hover:bg-[#142C52] text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : null}
            Salvar Fluxo
          </button>
        </div>
      </div>
      <div className="flex-1 w-full h-full bg-[#F8F9FB]">
        <ReactFlow
          nodes={nodesWithCallbacks}
          edges={edgesWithCallbacks}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Controls />
          <Background color="#CBD5E1" gap={16} />
        </ReactFlow>
      </div>
    </div>
  );
}
