import { type Dispatch } from 'react';
import { sendMessageStream, listMessages } from '../api';
import type { Action } from '../store/reducer';
import type { StreamEventType, AssistantContent, Message } from '../types';

async function* readSSELines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      yield line;
    }
  }
  // Flush remaining
  if (buffer) yield buffer;
}

function extractTextFromAssistantContent(content: AssistantContent[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export function useMessageStream(craftsmanId: string, dispatch: Dispatch<Action>) {
  return async function sendMessage(content: string): Promise<void> {
    // Optimistically add user message to UI
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      craftsman_id: craftsmanId,
      role: 'user',
      content,
      cost_usd: null,
      duration_ms: null,
      created_at: new Date().toISOString(),
    };

    dispatch({
      type: 'STREAM_DONE',
      craftsmanId,
      message: tempUserMsg,
    });

    let response: Response;
    try {
      response = await sendMessageStream(craftsmanId, content);
    } catch (err) {
      dispatch({ type: 'STREAM_ERROR', craftsmanId });
      throw err;
    }

    if (!response.body) {
      dispatch({ type: 'STREAM_ERROR', craftsmanId });
      throw new Error('No response body');
    }

    let currentEventType = '';

    try {
      for await (const line of readSSELines(response.body)) {
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const raw = line.slice(6);
          let event: StreamEventType;
          try {
            event = JSON.parse(raw) as StreamEventType;
          } catch {
            continue;
          }

          if (currentEventType === 'assistant' && event.type === 'assistant') {
            const msg = event as { type: 'assistant'; message: { content: AssistantContent[] } };
            const text = extractTextFromAssistantContent(msg.message.content);
            if (text) {
              dispatch({ type: 'STREAM_CHUNK', craftsmanId, content: text });
            }
          } else if (currentEventType === 'done' && event.type === 'done') {
            const done = event as { type: 'done'; result: string; cost_usd: number; duration_ms: number; message_id: string };
            const assistantMsg: Message = {
              id: done.message_id,
              craftsman_id: craftsmanId,
              role: 'assistant',
              content: done.result,
              cost_usd: done.cost_usd,
              duration_ms: done.duration_ms,
              created_at: new Date().toISOString(),
            };
            dispatch({ type: 'STREAM_DONE', craftsmanId, message: assistantMsg });
          } else if (currentEventType === 'error' && event.type === 'error') {
            dispatch({ type: 'STREAM_ERROR', craftsmanId });
            throw new Error((event as { type: 'error'; error: string }).error);
          }

          currentEventType = '';
        }
      }
    } catch (err) {
      dispatch({ type: 'STREAM_ERROR', craftsmanId });
      throw err;
    }

    // Sync canonical messages from server to ensure consistency
    try {
      const messages = await listMessages(craftsmanId);
      dispatch({ type: 'SET_MESSAGES', craftsmanId, messages });
    } catch {}
  };
}
