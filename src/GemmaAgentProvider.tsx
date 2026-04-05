import React, {
  createContext,
  useContext,
  useRef,
  useLayoutEffect,
  useMemo,
} from 'react';
import { ModelManager } from './ModelManager';
import { InferenceEngine } from './InferenceEngine';
import { SkillRegistry } from './SkillRegistry';
import { AgentOrchestrator } from './AgentOrchestrator';
import { SkillSandbox, type SkillSandboxHandle } from './SkillSandbox';
import type {
  ModelConfig,
  SkillManifest,
  InferenceEngineConfig,
  AgentConfig,
} from './types';

export type GemmaAgentContextValue = {
  modelManager: ModelManager;
  engine: InferenceEngine;
  registry: SkillRegistry;
  orchestrator: AgentOrchestrator;
};

const GemmaAgentContext = createContext<GemmaAgentContextValue | null>(null);

export type GemmaAgentProviderProps = {
  /** Model download config (repoId, filename, etc.) */
  model: ModelConfig;
  /** Skills to register on mount */
  skills?: SkillManifest[];
  /** Base system prompt for the agent */
  systemPrompt?: string;
  /** Inference engine configuration */
  engineConfig?: InferenceEngineConfig;
  /** Agent orchestrator configuration */
  agentConfig?: AgentConfig;
  children: React.ReactNode;
};

export function GemmaAgentProvider({
  model,
  skills,
  systemPrompt,
  engineConfig,
  agentConfig,
  children,
}: GemmaAgentProviderProps) {
  const sandboxRef = useRef<SkillSandboxHandle>(null);

  // Create SDK instances once (stable across re-renders)
  const instances = useRef<GemmaAgentContextValue | null>(null);
  if (!instances.current) {
    const modelManager = new ModelManager(model);
    const engine = new InferenceEngine(engineConfig);
    const registry = new SkillRegistry();

    const orchestrator = new AgentOrchestrator(engine, registry, {
      ...agentConfig,
      systemPrompt: systemPrompt ?? agentConfig?.systemPrompt,
    });

    if (skills) {
      for (const skill of skills) {
        registry.registerSkill(skill);
      }
    }

    instances.current = { modelManager, engine, registry, orchestrator };
  }

  // Wire SkillSandbox executor into orchestrator after mount
  useLayoutEffect(() => {
    if (sandboxRef.current) {
      instances.current!.orchestrator.setSkillExecutor(
        sandboxRef.current.execute,
      );
    }
  }, []);

  const value = useMemo(() => instances.current!, []);

  return (
    <GemmaAgentContext.Provider value={value}>
      {children}
      <SkillSandbox ref={sandboxRef} />
    </GemmaAgentContext.Provider>
  );
}

export function useGemmaAgentContext(): GemmaAgentContextValue {
  const ctx = useContext(GemmaAgentContext);
  if (!ctx) {
    throw new Error(
      'useGemmaAgent must be used within a <GemmaAgentProvider>',
    );
  }
  return ctx;
}
