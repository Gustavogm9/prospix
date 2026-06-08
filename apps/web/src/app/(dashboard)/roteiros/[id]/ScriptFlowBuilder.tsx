'use client';

import { useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  NodeProps,
  Edge,
  Node,
  Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Zap, Clock, MessageSquare, Play } from 'lucide-react';

const nodeTypes = {
  trigger: ({ data }: NodeProps) => (
    <div className="bg-white border-2 border-[#1B3A6B] rounded-xl shadow-md min-w-[250px]">
      <div className="bg-[#1B3A6B] text-white px-4 py-2 rounded-t-lg flex items-center gap-2">
        <Zap className="w-4 h-4 text-yellow-400" />
        <span className="font-bold text-sm">Gatilho (Início)</span>
      </div>
      <div className="p-4 text-sm text-[#475569] font-medium">
        {data.label as string}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-[#1B3A6B] bg-white" />
    </div>
  ),
  wait: ({ data }: NodeProps) => (
    <div className="bg-white border-2 border-[#E5E7EB] rounded-xl shadow-sm min-w-[250px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-[#E5E7EB] bg-white" />
      <div className="bg-[#F8F9FB] border-b border-[#E5E7EB] px-4 py-2 rounded-t-lg flex items-center gap-2">
        <Clock className="w-4 h-4 text-[#64748B]" />
        <span className="font-bold text-sm text-[#475569]">Espera</span>
      </div>
      <div className="p-4 text-sm text-[#475569] font-medium">
        {data.label as string}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-[#E5E7EB] bg-white" />
    </div>
  ),
  message: ({ data }: NodeProps) => (
    <div className="bg-white border-2 border-[#039855] rounded-xl shadow-md min-w-[250px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3 border-2 border-[#039855] bg-white" />
      <div className="bg-[#ECFDF3] border-b border-[#D1FADF] px-4 py-2 rounded-t-lg flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-[#039855]" />
        <span className="font-bold text-sm text-[#039855]">Enviar Roteiro</span>
      </div>
      <div className="p-4 text-sm text-[#475569] font-medium">
        {data.label as string}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 border-2 border-[#039855] bg-white" />
    </div>
  )
};

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'trigger',
    position: { x: 250, y: 50 },
    data: { label: 'Quando lead novo entrar na fila' },
  },
  {
    id: '2',
    type: 'wait',
    position: { x: 250, y: 200 },
    data: { label: 'Aguardar horário ideal (9h - 18h)' },
  },
  {
    id: '3',
    type: 'message',
    position: { x: 250, y: 350 },
    data: { label: 'Mensagem Inicial (Roteiro Ativo)' },
  },
  {
    id: '4',
    type: 'wait',
    position: { x: 250, y: 500 },
    data: { label: 'Aguardar resposta por 3 dias' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#94A3B8', strokeWidth: 2 } },
  { id: 'e2-3', source: '2', target: '3', animated: true, style: { stroke: '#94A3B8', strokeWidth: 2 } },
  { id: 'e3-4', source: '3', target: '4', animated: true, style: { stroke: '#94A3B8', strokeWidth: 2 } },
];

export function ScriptFlowBuilder() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#94A3B8', strokeWidth: 2 } }, eds)),
    [setEdges],
  );

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] flex flex-col h-[600px] overflow-hidden shadow-sm relative">
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
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Controls />
          <MiniMap zoomable pannable nodeClassName={(node) => {
            if (node.type === 'trigger') return 'bg-[#1B3A6B]';
            if (node.type === 'message') return 'bg-[#039855]';
            return 'bg-[#E5E7EB]';
          }} />
          <Background color="#E5E7EB" gap={16} />
        </ReactFlow>
      </div>
    </div>
  );
}
