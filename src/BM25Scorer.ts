import type { SkillManifest } from './types';

/**
 * BM25 (Best Matching 25) scorer for skill pre-filtering.
 *
 * Ranks skills by relevance to a user query using term frequency / inverse
 * document frequency with length normalization. Pure math, no ML model.
 *
 * Each skill's "document" is: name + description + parameter descriptions.
 */

const K1 = 1.5;
const B = 0.75;

type DocEntry = {
  skill: SkillManifest;
  tokens: string[];
  termFreqs: Map<string, number>;
};

export class BM25Scorer {
  private docs: DocEntry[] = [];
  private avgDl = 0;
  /** Number of documents containing each term */
  private df: Map<string, number> = new Map();

  /**
   * Build the index from a set of skill manifests.
   * Call this once when skills are registered (or change).
   */
  buildIndex(skills: SkillManifest[]): void {
    this.docs = [];
    this.df = new Map();

    for (const skill of skills) {
      const text = this.skillToText(skill);
      const tokens = this.tokenize(text);

      const termFreqs = new Map<string, number>();
      const seen = new Set<string>();

      for (const t of tokens) {
        termFreqs.set(t, (termFreqs.get(t) ?? 0) + 1);
        if (!seen.has(t)) {
          seen.add(t);
          this.df.set(t, (this.df.get(t) ?? 0) + 1);
        }
      }

      this.docs.push({ skill, tokens, termFreqs });
    }

    const totalTokens = this.docs.reduce((sum, d) => sum + d.tokens.length, 0);
    this.avgDl = this.docs.length > 0 ? totalTokens / this.docs.length : 0;
  }

  /**
   * Score all indexed skills against a query. Returns skills ranked by
   * descending BM25 score.
   */
  score(query: string): Array<{ skill: SkillManifest; score: number }> {
    const queryTokens = this.tokenize(query);
    const n = this.docs.length;

    const results = this.docs.map((doc) => {
      let total = 0;
      const dl = doc.tokens.length;

      for (const qt of queryTokens) {
        const tf = doc.termFreqs.get(qt) ?? 0;
        if (tf === 0) continue;

        const docFreq = this.df.get(qt) ?? 0;
        // IDF with floor at 0 to avoid negative scores
        const idf = Math.max(
          0,
          Math.log((n - docFreq + 0.5) / (docFreq + 0.5) + 1),
        );
        const tfNorm =
          (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / this.avgDl)));

        total += idf * tfNorm;
      }

      return { skill: doc.skill, score: total };
    });

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Convenience: score and return only the top-N skills.
   */
  topN(
    query: string,
    n: number,
  ): Array<{ skill: SkillManifest; score: number }> {
    return this.score(query).slice(0, n);
  }

  private skillToText(skill: SkillManifest): string {
    const parts = [skill.name, skill.description];
    for (const [key, param] of Object.entries(skill.parameters)) {
      parts.push(key);
      if (param.description) parts.push(param.description);
    }
    if (skill.instructions) parts.push(skill.instructions);
    return parts.join(' ');
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }
}
