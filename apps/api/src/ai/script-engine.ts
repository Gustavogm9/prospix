import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export interface ScriptNode {
  id: string;
  type: 'trigger' | 'wait' | 'message' | 'decision' | 'action' | 'end';
  data: {
    text?: string;
    nextNodeId?: string;
    actionType?: 'send_pdf' | 'schedule_meeting' | 'escalate_to_human' | 'mark_optout';
    routes?: Record<string, string>; // intent -> targetNodeId
    durationMinutes?: number;
  };
}

export interface ScriptFlow {
  nodes: ScriptNode[];
}

export interface ScriptStepResult {
  nextNodeId: string | null;
  messageToSend: string | null;
  actionToExecute: 'send_pdf' | 'schedule_meeting' | 'escalate_to_human' | 'mark_optout' | null;
  variationId: string | null;
  completed: boolean;
}

export function chooseVariation(
  variations: Array<{ id: string; message: string; weight: number }>
): { id: string; message: string } | null {
  if (variations.length === 0) return null;
  const first = variations[0];
  if (!first) return null;

  const totalWeight = variations.reduce((sum, v) => sum + Number(v.weight || 0), 0);
  if (totalWeight <= 0) return { id: first.id, message: first.message };

  let random = Math.random() * totalWeight;

  for (const variation of variations) {
    random -= Number(variation.weight || 0);
    if (random <= 0) {
      return { id: variation.id, message: variation.message };
    }
  }

  return { id: first.id, message: first.message };
}

export async function executeScriptStep(params: {
  tenantId: string;
  conversationId: string;
  intent?: string;
}): Promise<ScriptStepResult> {
  const { conversationId, intent = 'unclear' } = params;

  // 1. Fetch conversation with script
  const { data: conversation, error: convErr } = await dbAdmin
    .from('conversations')
    .select('*, scripts(*)')
    .eq('id', conversationId)
    .single();

  if (convErr || !conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  if (!conversation.script_id || !conversation.scripts) {
    logger.warn({ conversationId }, '⚠️ No script attached to this conversation');
    return {
      nextNodeId: null,
      messageToSend: null,
      actionToExecute: null,
      variationId: null,
      completed: true,
    };
  }

  const script = conversation.scripts as any;
  const flow = (script.flow as unknown as ScriptFlow) || { nodes: [] };
  const nodes = flow.nodes || [];

  if (nodes.length === 0) {
    logger.warn({ scriptId: conversation.script_id }, '⚠️ Script flow has no nodes');
    return {
      nextNodeId: null,
      messageToSend: null,
      actionToExecute: null,
      variationId: null,
      completed: true,
    };
  }

  // 2. Resolve current node ID
  let currentNodeId = conversation.current_node_id;
  if (!currentNodeId) {
    const triggerNode = nodes.find((n: ScriptNode) => n.type === 'trigger');
    currentNodeId = triggerNode ? triggerNode.id : nodes[0]!.id;
  }

  let currentNode = nodes.find((n: ScriptNode) => n.id === currentNodeId);
  if (!currentNode) {
    logger.error({ currentNodeId }, '❌ Current node ID not found in script flow');
    return {
      nextNodeId: null,
      messageToSend: null,
      actionToExecute: null,
      variationId: null,
      completed: true,
    };
  }

  // 3. Run State Machine Loop
  let messageToSend: string | null = null;
  let actionToExecute: 'send_pdf' | 'schedule_meeting' | 'escalate_to_human' | 'mark_optout' | null = null;
  let variationId: string | null = null;
  let completed = false;
  let nextNodeId: string | null = currentNodeId;

  let stepsRun = 0;
  const maxSteps = 10; // avoid infinite loops

  while (currentNode && stepsRun < maxSteps) {
    stepsRun++;
    logger.info(
      { conversationId, nodeId: currentNode.id, type: currentNode.type },
      '🔄 Processing script node'
    );

    if (currentNode.type === 'trigger') {
      nextNodeId = currentNode.data.nextNodeId || null;
      if (!nextNodeId) {
        completed = true;
        break;
      }
      currentNode = nodes.find((n: ScriptNode) => n.id === nextNodeId);
    } else if (currentNode.type === 'decision') {
      // Branch based on intent
      const routes = currentNode.data.routes || {};
      nextNodeId = routes[intent] || routes['default'] || routes['unclear'] || null;
      if (!nextNodeId) {
        completed = true;
        break;
      }
      currentNode = nodes.find((n: ScriptNode) => n.id === nextNodeId);
    } else if (currentNode.type === 'action') {
      actionToExecute = currentNode.data.actionType || null;
      nextNodeId = currentNode.data.nextNodeId || null;
      if (nextNodeId) {
        currentNode = nodes.find((n: ScriptNode) => n.id === nextNodeId);
      } else {
        completed = true;
        break;
      }
    } else if (currentNode.type === 'message') {
      // Pick variant A/B/C if there are variations in the database
      const { data: dbVariations } = await dbAdmin
        .from('script_variations')
        .select('*')
        .eq('script_id', conversation.script_id)
        .eq('active', true);

      if (dbVariations && dbVariations.length > 0) {
        const chosen = chooseVariation(
          dbVariations.map((v: any) => ({
            id: v.id,
            message: v.message,
            weight: Number(v.weight),
          }))
        );

        if (chosen) {
          messageToSend = chosen.message;
          variationId = chosen.id;
        }
      }

      if (!messageToSend) {
        // Fallback to node text or baseMessage
        messageToSend = currentNode.data.text || script.base_message || null;
      }

      nextNodeId = currentNode.data.nextNodeId || null;
      break; // Message node halts the execution waiting for lead reply
    } else if (currentNode.type === 'wait') {
      nextNodeId = currentNode.data.nextNodeId || null;
      break; // Wait node halts the execution
    } else if (currentNode.type === 'end') {
      nextNodeId = null;
      completed = true;
      break;
    } else {
      logger.error({ type: currentNode.type }, '❌ Invalid node type in script flow');
      completed = true;
      break;
    }
  }

  // 4. Persist updated node ID back to the conversation
  const { error: updateErr } = await dbAdmin
    .from('conversations')
    .update({
      current_node_id: nextNodeId,
    })
    .eq('id', conversationId);

  if (updateErr) throw updateErr;

  return {
    nextNodeId,
    messageToSend,
    actionToExecute,
    variationId,
    completed,
  };
}
