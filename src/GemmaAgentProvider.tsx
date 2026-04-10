import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useLayoutEffect,
  useMemo,
} from 'react';
import { ModelManager } from './ModelManager';
import { InferenceEngine } from './InferenceEngine';
import { SkillRegistry } from './SkillRegistry';
import { AgentOrchestrator } from './AgentOrchestrator';
import { KnowledgeStore } from './KnowledgeStore';
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
  knowledgeStore: KnowledgeStore | null;
  activeCategories: string[] | undefined;
  setActiveCategories: (categories: string[] | undefined) => void;
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
  /** Optional shared KnowledgeStore instance. When provided, used for both
   *  the local_notes skill and useKnowledgeStore(). When omitted, a default
   *  instance is created if local_notes is in the skills list. */
  knowledgeStore?: KnowledgeStore;
  children: React.ReactNode;
};

export function GemmaAgentProvider({
  model,
  skills,
  systemPrompt,
  engineConfig,
  agentConfig,
  knowledgeStore: externalStore,
  children,
}: GemmaAgentProviderProps) {
  const sandboxRef = useRef<SkillSandboxHandle>(null);

  // Create SDK instances once (stable across re-renders)
  const instances = useRef<Omit<GemmaAgentContextValue, 'activeCategories' | 'setActiveCategories'> | null>(null);
  if (!instances.current) {
    const modelManager = new ModelManager(model);
    const engine = new InferenceEngine(engineConfig);
    const registry = new SkillRegistry();

    const orchestrator = new AgentOrchestrator(engine, registry, {
      ...agentConfig,
      systemPrompt: systemPrompt ?? agentConfig?.systemPrompt,
    });

    // Use the externally-provided KnowledgeStore if given, otherwise
    // create a default one when local_notes is in the skills list.
    // This ensures the skill, hook, and orchestrator all share one instance.
    const hasLocalNotes = skills?.some((s) => s.name === 'local_notes');
    let knowledgeStore: KnowledgeStore | null = externalStore ?? null;
    if (hasLocalNotes && !knowledgeStore) {
      knowledgeStore = new KnowledgeStore();
    }
    if (knowledgeStore) {
      orchestrator.setKnowledgeStore(knowledgeStore);
    }

    if (skills) {
      for (const skill of skills) {
        registry.registerSkill(skill);
      }
    }

    instances.current = {
      modelManager,
      engine,
      registry,
      orchestrator,
      knowledgeStore,
    };
  }

  // Wire SkillSandbox executor into orchestrator after mount
  useLayoutEffect(() => {
    if (sandboxRef.current) {
      instances.current!.orchestrator.setSkillExecutor(
        sandboxRef.current.execute,
      );
    }
  }, []);

  const [activeCategories, setActiveCategoriesState] = useState<
    string[] | undefined
  >(agentConfig?.activeCategories);

  const setActiveCategories = useCallback(
    (categories: string[] | undefined) => {
      setActiveCategoriesState(categories);
      instances.current!.orchestrator.setActiveCategories(categories);
    },
    [],
  );

  const value = useMemo(
    () => ({
      modelManager: instances.current!.modelManager,
      engine: instances.current!.engine,
      registry: instances.current!.registry,
      orchestrator: instances.current!.orchestrator,
      knowledgeStore: instances.current!.knowledgeStore,
      activeCategories,
      setActiveCategories,
    }),
    [activeCategories, setActiveCategories],
  );

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
