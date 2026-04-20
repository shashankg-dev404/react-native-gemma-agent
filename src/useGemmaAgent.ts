import { useState, useCallback, useRef } from 'react';
import { useGemmaAgentContext } from './GemmaAgentProvider';
import type { Message, ModelStatus, AgentEvent, ContextUsage } from './types';

export type UseGemmaAgentReturn = {
  /** Send a message to the agent. Returns the final response text. */
  sendMessage: (
    text: string,
    onEvent?: (event: AgentEvent) => void,
  ) => Promise<string>;
  /** Conversation history */
  messages: ReadonlyArray<Message>;
  /** Content tokens streamed so far (thinking excluded). Empty when idle. */
  streamingText: string;
  /** Whether the agent is currently processing */
  isProcessing: boolean;
  /** Whether the model is loaded and ready for inference */
  isModelLoaded: boolean;
  /** Current model status */
  modelStatus: ModelStatus;
  /** Name of the skill currently being executed, or null */
  activeSkill: string | null;
  /** Last error message, or null */
  error: string | null;
  /** Current context window usage (updated after each generation) */
  contextUsage: ContextUsage;
  /** Currently active skill categories (undefined = all categories) */
  activeCategories: string[] | undefined;
  /** Set which skill categories are active. Pass undefined to include all. */
  setActiveCategories: (categories: string[] | undefined) => void;
  /** Load the model into memory. Must be downloaded first. */
  loadModel: (onProgress?: (percent: number) => void) => Promise<number>;
  /** Unload the model from memory */
  unloadModel: () => Promise<void>;
  /** Clear conversation history */
  reset: () => void;
  /**
   * Clear conversation history and reset context-usage tracking.
   * Use this when `onContextWarning` fires to reclaim the context window.
   * Equivalent to `reset()` but additionally zeroes the `contextUsage` state
   * so the warning can re-fire on the next threshold crossing.
   */
  resetConversation: () => void;
};

export function useGemmaAgent(): UseGemmaAgentReturn {
  const {
    modelManager,
    engine,
    orchestrator,
    activeCategories,
    setActiveCategories,
  } = useGemmaAgentContext();

  const [messages, setMessages] = useState<ReadonlyArray<Message>>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>(
    modelManager.status,
  );
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage>({
    used: 0,
    total: 0,
    percent: 0,
  });

  // Track model status changes
  const unsubRef = useRef<(() => void) | null>(null);
  if (!unsubRef.current) {
    unsubRef.current = modelManager.onStatusChange((status) => {
      setModelStatus(status);
    });
  }

  // Buffer to detect special token sequences in streaming
  const tokenBufferRef = useRef('');
  // Whether we've seen the model produce content tokens (after thinking)
  const seenContentRef = useRef(false);

  const loadModel = useCallback(
    async (onProgress?: (percent: number) => void): Promise<number> => {
      let path = modelManager.modelPath;
      if (!path) {
        path = await modelManager.findModel();
      }
      if (!path) {
        throw new Error(
          'Model not found on device. Download it first via useModelDownload().',
        );
      }

      setModelStatus('loading');
      try {
        const loadTimeMs = await engine.loadModel(path, onProgress);
        setModelStatus('loaded');
        return loadTimeMs;
      } catch (err) {
        setModelStatus('error');
        throw err;
      }
    },
    [modelManager, engine],
  );

  const unloadModel = useCallback(async () => {
    await engine.unload();
    orchestrator.reset();
    setMessages([]);
    setStreamingText('');
    setError(null);
    setActiveSkill(null);
    setContextUsage({ used: 0, total: 0, percent: 0 });
    setModelStatus(modelManager.modelPath ? 'ready' : 'not_downloaded');
  }, [engine, orchestrator, modelManager]);

  const sendMessage = useCallback(
    async (
      text: string,
      onEvent?: (event: AgentEvent) => void,
    ): Promise<string> => {
      if (!engine.isLoaded) {
        throw new Error('Model not loaded. Call loadModel() first.');
      }

      setError(null);
      setIsProcessing(true);
      setActiveSkill(null);
      setStreamingText('');
      tokenBufferRef.current = '';
      seenContentRef.current = false;

      try {
        const response = await orchestrator.sendMessage(
          text,
          (event: AgentEvent) => {
            switch (event.type) {
              case 'token': {
                tokenBufferRef.current += event.token;
                const buf = tokenBufferRef.current;

                // Gemma 4 prefixes reasoning with "thought\n" before the final
                // answer. Suppress those tokens from streamingText so the UI
                // only previews the answer. llama.rn returns stripped content
                // at the end, so this is best-effort.
                if (!seenContentRef.current) {
                  if (buf.length >= 7) {
                    if (buf.trimStart().startsWith('thought')) {
                      break;
                    }
                    seenContentRef.current = true;
                    setStreamingText(buf);
                  }
                  break;
                }

                setStreamingText((prev) => prev + event.token);
                break;
              }
              case 'thinking':
                // Reset streaming state at the start of each generation loop.
                // Ensures clean slate before the final answer turn (after tool results).
                setStreamingText('');
                tokenBufferRef.current = '';
                seenContentRef.current = false;
                break;
              case 'skill_called':
                setActiveSkill(event.name);
                setStreamingText('');
                tokenBufferRef.current = '';
                seenContentRef.current = false;
                break;
              case 'skill_result':
                setActiveSkill(null);
                break;
              case 'context_warning':
                setContextUsage(event.usage);
                break;
              case 'error':
                setError(event.error);
                break;
              case 'response':
                setStreamingText('');
                tokenBufferRef.current = '';
                seenContentRef.current = false;
                setMessages([...orchestrator.conversation]);
                break;
            }
            // Always forward raw events to the developer's callback
            onEvent?.(event);
          },
        );

        setMessages([...orchestrator.conversation]);
        setContextUsage(engine.getContextUsage());
        return response;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        throw err;
      } finally {
        setIsProcessing(false);
        setActiveSkill(null);
        setStreamingText('');
        tokenBufferRef.current = '';
        seenContentRef.current = false;
      }
    },
    [engine, orchestrator],
  );

  const reset = useCallback(() => {
    orchestrator.reset();
    setMessages([]);
    setStreamingText('');
    setError(null);
    setActiveSkill(null);
  }, [orchestrator]);

  const resetConversation = useCallback(() => {
    orchestrator.reset();
    setMessages([]);
    setStreamingText('');
    setError(null);
    setActiveSkill(null);
    setContextUsage({ used: 0, total: 0, percent: 0 });
  }, [orchestrator]);

  return {
    sendMessage,
    messages,
    streamingText,
    isProcessing,
    isModelLoaded: engine.isLoaded,
    modelStatus,
    activeSkill,
    error,
    contextUsage,
    activeCategories,
    setActiveCategories,
    loadModel,
    unloadModel,
    reset,
    resetConversation,
  };
}
