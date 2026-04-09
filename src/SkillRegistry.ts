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
   * Returns skills matching the given category.
   */
  getSkillsByCategory(category: string): SkillManifest[] {
    return this.getSkills().filter(
      (s) => (s.category ?? 'uncategorized') === category,
    );
  }

  /**
   * Returns all unique category names across registered skills.
   * Skills without a category appear as 'uncategorized'.
   */
  getCategories(): string[] {
    const cats = new Set<string>();
    for (const skill of this.skills.values()) {
      cats.add(skill.category ?? 'uncategorized');
    }
    return Array.from(cats);
  }

  /**
   * Filter skills by active categories.
   * When activeCategories is undefined/empty, returns all skills (no filtering).
   * Uncategorized skills are included if 'uncategorized' is in the list.
   */
  getSkillsForCategories(activeCategories?: string[]): SkillManifest[] {
    if (!activeCategories || activeCategories.length === 0) {
      return this.getSkills();
    }
    const allowed = new Set(activeCategories);
    return this.getSkills().filter((s) =>
      allowed.has(s.category ?? 'uncategorized'),
    );
  }

  /**
   * Convert registered skills to OpenAI-compatible tool definitions.
   * Pass these to InferenceEngine.generate() as the `tools` parameter —
   * llama.rn handles the rest via Jinja templates + Gemma 4 chat format.
   *
   * When activeCategories is provided, only skills in those categories are included.
   */
  toToolDefinitions(activeCategories?: string[]): ToolDefinition[] {
    const skills = this.getSkillsForCategories(activeCategories);
    return skills.map(skill => ({
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
