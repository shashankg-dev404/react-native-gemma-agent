import type { SkillManifest } from '../src/types';

export const calculatorSkill: SkillManifest = {
  name: 'calculator',
  description: 'Evaluate mathematical expressions accurately.',
  version: '1.0.0',
  type: 'native',
  requiresNetwork: false,
  category: 'utility',
  parameters: {
    expression: {
      type: 'string',
      description: 'Mathematical expression to evaluate (e.g. "2 + 3 * 4")',
    },
  },
  requiredParameters: ['expression'],
  instructions:
    'Use this when the user asks for calculations, math, unit conversions, or percentages. Pass the expression as a string.',
  execute: async (params) => {
    try {
      const raw = String(params.expression ?? '');

      // Replace ^ with ** for exponentiation
      const expr = raw.replace(/\^/g, '**');

      // Only allow safe characters: digits, operators, parens, decimal, spaces
      if (!/^[\d\s+\-*/().%*]+$/.test(expr)) {
        return {
          error:
            'Invalid expression: only numbers and basic operators (+, -, *, /, ^, %, parentheses) are allowed.',
        };
      }

      // eslint-disable-next-line no-new-func
      const result = new Function(`"use strict"; return (${expr});`)();

      if (typeof result !== 'number' || !Number.isFinite(result)) {
        return { error: 'Expression did not produce a valid number.' };
      }

      return { result: String(result) };
    } catch (err) {
      return {
        error: `Calculator error: ${err instanceof Error ? err.message : 'Invalid expression'}`,
      };
    }
  },
};
