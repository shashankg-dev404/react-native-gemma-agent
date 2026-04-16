import { useState, useCallback, useRef } from 'react';
import { useOptionalGemmaAgentContext } from './GemmaAgentProvider';
import { InferenceEngine } from './InferenceEngine';
import { ModelManager } from './ModelManager';
import { resolveModelConfig } from './ModelRegistry';
import type {
  Message,
  ModelConfig,
  InferenceEngineConfig,
  ContextUsage,
  GenerateOptions,
} from './types';

export type UseLLMConfig = {
  /** Model ID string (e.g. 'qwen-3.5-4b') or a ModelConfig object */
  model?: string | ModelConfig;
  systemPrompt?: string;
  engineConfig?: InferenceEngineConfig;
  generateOptions?: Pick<GenerateOptions, 'maxTokens' | 'temperature' | 'topP' | 'topK' | 'stop'>;
};

export type UseLLMReturn = {
  generate: (prompt: string) => Promise<string>;
  stream: (prompt: string) => Promise<string>;
  isReady: boolean;
  interrupt: () => Promise<void>;
  isGenerating: boolean;
  response: string;
  streamingText: string;
  error: string | null;
  contextUsage: ContextUsage;
  loadModel: (modelPath?: string) => Promise<number>;
  unloadModel: () => Promise<void>;
  reset: () => void;
};

let sharedEngine: InferenceEngine | null = null;
let sharedModelManager: ModelManager | null = null;

function getStandaloneEngine(config?: InferenceEngineConfig): InferenceEngine {
  if (!sharedEngine) {
    sharedEngine = new InferenceEngine(config);
  }
  return sharedEngine;
}

function getStandaloneModelManager(model?: string | ModelConfig): ModelManager | null {
  if (!model) return null;
  if (!sharedModelManager) {
    const resolved = resolveModelConfig(model);
    sharedModelManager = new ModelManager(resolved);
  }
  return sharedModelManager;
}

export function useLLM(config?: UseLLMConfig): UseLLMReturn {
  const ctx = useOptionalGemmaAgentContext();

  const instancesRef = useRef<{ engine: InferenceEngine; modelManager: ModelManager | null } | null>(null);
  if (!instancesRef.current) {
    if (ctx) {
      instancesRef.current = { engine: ctx.engine, modelManager: ctx.modelManager };
    } else {
      instancesRef.current = {
        engine: getStandaloneEngine(config?.engineConfig),
        modelManager: getStandaloneModelManager(config?.model),
      };
    }
  }

  const { engine, modelManager } = instancesRef.current;
  const systemPrompt = config?.systemPrompt ?? '';
  const genOpts = config?.generateOptions;

  const historyRef = useRef<Message[]>([]);
  const streamBufferRef = useRef('');

  const [response, setResponse] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage>({
    used: 0,
    total: 0,
    percent: 0,
  });

  const buildMessages = useCallback(
    (prompt: string): Message[] => {
      const msgs: Message[] = [];
      if (systemPrompt) {
        msgs.push({ role: 'system', content: systemPrompt });
      }
      msgs.push(...historyRef.current);
      msgs.push({ role: 'user', content: prompt });
      return msgs;
    },
    [systemPrompt],
  );

  const generate = useCallback(
    async (prompt: string): Promise<string> => {
      if (!engine.isLoaded) {
        throw new Error('Model not loaded. Call loadModel() first.');
      }
      if (engine.isGenerating) {
        throw new Error('Generation already in progress.');
      }

      setError(null);
      setIsGenerating(true);
      setStreamingText('');
      streamBufferRef.current = '';

      try {
        const messages = buildMessages(prompt);
        const result = await engine.generate(messages, {
          ...genOpts,
        });

        const text = result.content;
        historyRef.current.push(
          { role: 'user', content: prompt },
          { role: 'assistant', content: text },
        );
        setResponse(text);
        setContextUsage(engine.getContextUsage());
        return text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        throw err;
      } finally {
        setIsGenerating(false);
        setStreamingText('');
        streamBufferRef.current = '';
      }
    },
    [engine, buildMessages, genOpts],
  );

  const stream = useCallback(
    async (prompt: string): Promise<string> => {
      if (!engine.isLoaded) {
        throw new Error('Model not loaded. Call loadModel() first.');
      }
      if (engine.isGenerating) {
        throw new Error('Generation already in progress.');
      }

      setError(null);
      setIsGenerating(true);
      setStreamingText('');
      setResponse('');
      streamBufferRef.current = '';

      try {
        const messages = buildMessages(prompt);
        const result = await engine.generate(
          messages,
          { ...genOpts },
          (event) => {
            streamBufferRef.current += event.token;
            setStreamingText(streamBufferRef.current);
          },
        );

        const text = result.content;
        historyRef.current.push(
          { role: 'user', content: prompt },
          { role: 'assistant', content: text },
        );
        setResponse(text);
        setStreamingText('');
        streamBufferRef.current = '';
        setContextUsage(engine.getContextUsage());
        return text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        throw err;
      } finally {
        setIsGenerating(false);
      }
    },
    [engine, buildMessages, genOpts],
  );

  const interrupt = useCallback(async () => {
    await engine.stopGeneration();
  }, [engine]);

  const loadModel = useCallback(
    async (modelPath?: string): Promise<number> => {
      let path: string | undefined | null = modelPath;
      if (!path && modelManager) {
        path = modelManager.modelPath;
        if (!path) {
          path = await modelManager.findModel();
        }
      }
      if (!path) {
        throw new Error(
          'No model path. Pass a path to loadModel() or provide a model config to useLLM().',
        );
      }
      return engine.loadModel(path);
    },
    [engine, modelManager],
  );

  const unloadModel = useCallback(async () => {
    await engine.unload();
    historyRef.current = [];
    setResponse('');
    setStreamingText('');
    streamBufferRef.current = '';
    setError(null);
    setContextUsage({ used: 0, total: 0, percent: 0 });
  }, [engine]);

  const reset = useCallback(() => {
    historyRef.current = [];
    engine.resetContextUsage();
    setResponse('');
    setStreamingText('');
    streamBufferRef.current = '';
    setError(null);
    setContextUsage({ used: 0, total: 0, percent: 0 });
  }, [engine]);

  return {
    generate,
    stream,
    isReady: engine.isLoaded,
    interrupt,
    isGenerating,
    response,
    streamingText,
    error,
    contextUsage,
    loadModel,
    unloadModel,
    reset,
  };
}
