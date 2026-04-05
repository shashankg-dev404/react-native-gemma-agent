import { useState, useCallback } from 'react';
import { useGemmaAgentContext } from './GemmaAgentProvider';
import type { SkillManifest } from './types';

export type UseSkillRegistryReturn = {
  /** Register a new skill */
  registerSkill: (skill: SkillManifest) => void;
  /** Remove a skill by name */
  unregisterSkill: (name: string) => void;
  /** All registered skills */
  skills: SkillManifest[];
  /** Check if a skill is registered */
  hasSkill: (name: string) => boolean;
  /** Remove all skills */
  clear: () => void;
};

export function useSkillRegistry(): UseSkillRegistryReturn {
  const { registry } = useGemmaAgentContext();

  // Counter to trigger re-renders when skills change
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const registerSkill = useCallback(
    (skill: SkillManifest) => {
      registry.registerSkill(skill);
      bump();
    },
    [registry],
  );

  const unregisterSkill = useCallback(
    (name: string) => {
      registry.unregisterSkill(name);
      bump();
    },
    [registry],
  );

  const clear = useCallback(() => {
    registry.clear();
    bump();
  }, [registry]);

  const hasSkill = useCallback(
    (name: string) => registry.hasSkill(name),
    [registry],
  );

  return {
    registerSkill,
    unregisterSkill,
    skills: registry.getSkills(),
    hasSkill,
    clear,
  };
}
