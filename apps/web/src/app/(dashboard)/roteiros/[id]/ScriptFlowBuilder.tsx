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
import { Zap, Clock, MessageSquare, Play, GitBranch, Calendar, CheckCircle2 } from 'lucide-react';

const nodeTypes = {
  trigger: ({ data }: NodeProps) => (
    <div className="bg-white border-2 border-orange-400 rounded-xl shadow-md w-[400px]">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-gray-500" />
          <span className="font-bold text-[15px] text-gray-900">{data.title as string}</span>
          <span className="text-[10px] font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full ml-2">GATILHO</span>
        </div>
      </div>
      <div className="p-5 text-[14px] text-gray-600 font-medium">
        {data.content as React.ReactNode}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-orange-400 bg-white" />
    </div>
  ),
  wait: ({ data }: NodeProps) => (
    <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl shadow-sm w-[400px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-[#E5E7EB] bg-white" />
      <div className="px-5 py-3 flex items-center gap-2">
        <Clock className="w-4 h-4 text-gray-400" />
        <span className="font-bold text-[14px] text-gray-900">{data.title as string}</span>
        <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full ml-auto">ESPERA</span>
      </div>
      {data.content ? (
        <div className="px-5 pb-4 text-[13px] text-gray-600">
          {data.content as string}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-[#E5E7EB] bg-white" />
    </div>
  ),
  send: ({ data }: NodeProps) => {
    // some nodes are styled green (like Apresentar coberturas) instead of dark blue
    const borderColor = data.styleVariant === 'green' ? 'border-green-500' : 'border-[#1B3A6B]';
    return (
      <div className={`bg-white border-2 ${borderColor} rounded-xl shadow-md w-[400px] overflow-hidden`}>
        <Handle type="target" position={Position.Top} className={`w-3 h-3 border-2 ${borderColor} bg-white`} />
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-gray-400" />
            <span className="font-bold text-[14px] text-gray-900">{data.title as string}</span>
            <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full ml-2">ENVIO</span>
          </div>
        </div>
        <div className="p-5">
          <div className={`bg-[#F3EFE9] p-4 rounded-xl text-[13px] text-gray-700 italic border-l-4 ${data.styleVariant === 'green' ? 'border-gray-400' : 'border-green-500'}`}>
            {data.message as string}
          </div>
          {(data.variations || data.responseRate) ? (
            <div className="mt-4 flex items-center gap-4 text-[12px] font-bold text-gray-500">
              {data.variations ? <span className="flex items-center gap-1"><GitBranch className="w-3 h-3 text-orange-400" /> {data.variations as React.ReactNode} variações</span> : null}
              {data.responseRate ? <span className="text-green-600">{data.responseRate as React.ReactNode} resposta</span> : null}
            </div>
          ) : null}
        </div>
        <Handle type="source" position={Position.Bottom} className={`w-3 h-3 border-2 ${borderColor} bg-white`} />
      </div>
    );
  },
  decision: ({ data }: NodeProps) => (
    <div className="bg-white border-2 border-orange-400 rounded-xl shadow-md w-[400px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-orange-400 bg-white" />
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-gray-400" />
          <span className="font-bold text-[14px] text-gray-900">{data.title as string}</span>
          <span className="text-[10px] font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full ml-2">DECISÃO</span>
        </div>
      </div>
      <div className="p-5 text-[13px] text-gray-600 font-medium">
        {data.content as string}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-orange-400 bg-white" />
    </div>
  ),
  action: ({ data }: NodeProps) => (
    <div className="bg-white border-2 border-green-500 rounded-xl shadow-md w-[400px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-green-500 bg-white" />
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-400" />
        <span className="font-bold text-[14px] text-gray-900">{data.title as string}</span>
        <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full ml-auto">AÇÃO</span>
      </div>
      <div className="p-5 text-[13px] text-gray-600">
        {data.content as string}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-green-500 bg-white" />
    </div>
  ),
  final: ({ data }: NodeProps) => (
    <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl shadow-sm w-[600px] flex flex-col items-center justify-center p-5">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-[#E5E7EB] bg-white" />
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 className="w-5 h-5 text-gray-400" />
        <span className="font-bold text-[15px] text-gray-900">{data.title as string}</span>
        <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full ml-2">FINAL</span>
      </div>
      <div className="text-[12px] font-bold text-gray-400 flex items-center gap-2">
        <span className="text-green-500">{data.percent as string}</span> chegam aqui
        <span className="mx-1">•</span>
        <span>{data.tests as string}</span>
      </div>
    </div>
  )
};

const CustomEdge = ({ id: _id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) => {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <>
      <BaseEdge path={edgePath} style={{ stroke: '#CBD5E1', strokeWidth: 2 }} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div className={`px-4 py-1.5 rounded-full text-[11px] font-bold border shadow-sm uppercase ${
              data.variant === 'positive' 
                ? 'bg-white text-green-600 border-green-200' 
                : 'bg-white text-red-500 border-red-200'
            }`}>
              {data.label as string}
            </div>
          </div>
        </EdgeLabelRenderer>
      ) : null}
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
      title: 'Lead capturado',
      content: (
        <>
          <p className="mb-4">Quando lead novo de <strong>médico</strong> entra na fila com WhatsApp válido, perfil ativo e fit score ≥ 7.</p>
          <div className="flex gap-3">
            <span className="flex items-center gap-1 text-[11px] bg-red-50 text-red-600 px-2 py-1 rounded-md">📍 SJRP</span>
            <span className="flex items-center gap-1 text-[11px] bg-purple-50 text-purple-600 px-2 py-1 rounded-md">👩‍⚕️ médicos</span>
            <span className="flex items-center gap-1 text-[11px] bg-yellow-50 text-yellow-600 px-2 py-1 rounded-md">⭐ fit ≥ 7</span>
          </div>
        </>
      )
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
      message: '"Oi Dr. {{NOME}}, tudo bem? Aqui é o Giovane, corretor da MetLife em SJRP. Trabalho com proteção de renda pra médicos que dependem da própria atuação. Posso te explicar em 30s como funciona?"',
      variations: 14,
      responseRate: '32%'
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
    data: { title: 'Classificar intenção', content: 'IA analisa o conteúdo da resposta e ramifica em 4 caminhos' },
  },
  {
    id: '6',
    type: 'send',
    position: { x: 50, y: 1180 },
    data: { title: 'Apresentar 3 coberturas', message: 'Doença grave - cirurgia - diárias DIH', styleVariant: 'green' },
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
    data: { title: 'Diferenciador MetLife', message: '"Maioria cobre só morte. O nosso protege renda também..."', styleVariant: 'green' },
  },
  {
    id: '9',
    type: 'decision',
    position: { x: 550, y: 1400 },
    data: { title: 'Continuou?', content: 'Volta pra "Interessado" se sim - arquiva se não' },
  },
  {
    id: '10',
    type: 'final',
    position: { x: 200, y: 1650 },
    data: { title: 'Reunião agendada - fluxo completo', percent: '9%', tests: '180 testes' },
  }
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', type: 'custom' },
  { id: 'e2-3', source: '2', target: '3', type: 'custom' },
  { id: 'e3-4', source: '3', target: '4', type: 'custom' },
  { id: 'e4-5', source: '4', target: '5', type: 'custom' },
  { id: 'e5-6', source: '5', target: '6', type: 'custom', data: { label: 'INTERESSADO', variant: 'positive' } },
  { id: 'e5-8', source: '5', target: '8', type: 'custom', data: { label: 'JÁ TEM SEGURO', variant: 'negative' } },
  { id: 'e6-7', source: '6', target: '7', type: 'custom' },
  { id: 'e8-9', source: '8', target: '9', type: 'custom' },
  { id: 'e7-10', source: '7', target: '10', type: 'custom' },
  { id: 'e9-10', source: '9', target: '10', type: 'custom' }
];

export function ScriptFlowBuilder() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, type: 'custom' } as Edge, eds)),
    [setEdges],
  );

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] flex flex-col h-[700px] overflow-hidden shadow-sm relative">
      <div className="p-5 border-b border-[#F1F3F6] flex items-center justify-between z-10 bg-white">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
            <Play className="w-5 h-5 text-[#1B3A6B]" />
            Fluxo da Conversa
          </h2>
          <p className="text-[13px] text-[#64748B] mt-1">
            Arraste e solte para definir o momento exato em que esta mensagem será disparada.
          </p>
        </div>
      </div>
      <div className="flex-1 w-full h-full bg-[#F8F9FB]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.5}
        >
          <Controls />
          <Background color="#CBD5E1" gap={16} />
        </ReactFlow>
      </div>
    </div>
  );
}
