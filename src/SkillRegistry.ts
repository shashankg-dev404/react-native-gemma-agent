import type { SkillManifest, ToolDefinition } from './types';

export class SkillRegistry {
  private skills: Map<string, SkillManifest> = new Map();

  /**
   * Register a skill. Validates that required fields are present.
   */
  registerSkill(skill: SkillManifest): void {
    if (skill.type === 'js' && !skill.html) {
      throw new Error(`JS skill "${skill.name}" requires an html field`);
    }
    if (skill.type === 'native' && !skill.execute) {
      throw new Error(`Native skill "${skill.name}" requires an execute function`);
    }
    this.skills.set(skill.name, skill);
  }

  unregisterSkill(name: string): void {
    this.skills.delete(name);
  }

  getSkill(name: string): SkillManifest | null {
    return this.skills.get(name) ?? null;
  }

  getSkills(): SkillManifest[] {
    return Array.from(this.skills.values());
  }

  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Convert registered skills to OpenAI-compatible tool definitions.
   * Pass these to InferenceEngine.generate() as the `tools` parameter —
   * llama.rn handles the rest via Jinja templates + Gemma 4 chat format.
   */
  toToolDefinitions(): ToolDefinition[] {
    return this.getSkills().map(skill => ({
      type: 'function' as const,
      function: {
        name: skill.name,
        description:
          skill.description +
          (skill.instructions ? `\n${skill.instructions}` : ''),
        parameters: {
          type: 'object' as const,
          properties: skill.parameters,
          required: skill.requiredParameters,
        },
      },
    }));
  }

  clear(): void {
    this.skills.clear();
  }
}
