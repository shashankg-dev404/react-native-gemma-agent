/**
 * Tests for LaTeX stripping logic used in the Wikipedia skill.
 * The function is embedded in the skill's HTML — we extract and test the same logic here.
 */

function stripLatex(text: string): string {
  if (!text) return text;
  // Remove display math $$...$$
  text = text.replace(/\$\$[^$]*\$\$/g, '');
  // Remove inline math $...$  (but not dollar amounts like $5)
  text = text.replace(/\$[^$\d][^$]*\$/g, '');
  // Replace \frac{a}{b} with a/b
  text = text.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
  // Replace \text{...}, \mathrm{...}, etc. with contents
  text = text.replace(
    /\\(text|mathrm|mathbf|mathit|mathbb|mathcal|operatorname)\{([^}]*)\}/g,
    '$2',
  );
  // Replace \sqrt{x} with sqrt(x)
  text = text.replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)');
  // Remove \displaystyle and similar
  text = text.replace(
    /\\(displaystyle|textstyle|scriptstyle|left|right|Big|big)\s*/g,
    '',
  );
  // Replace common symbols
  text = text.replace(/\\times/g, 'x');
  text = text.replace(/\\cdot/g, '*');
  text = text.replace(/\\approx/g, '≈');
  text = text.replace(/\\pm/g, '±');
  text = text.replace(/\\leq/g, '<=');
  text = text.replace(/\\geq/g, '>=');
  text = text.replace(/\\neq/g, '!=');
  text = text.replace(/\\infty/g, 'infinity');
  text = text.replace(/\\sum/g, 'sum');
  text = text.replace(/\\int/g, 'integral');
  // Remove remaining \command patterns
  text = text.replace(/\\[a-zA-Z]+/g, '');
  // Clean up leftover braces
  text = text.replace(/[{}]/g, '');
  // Clean up extra whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

describe('stripLatex', () => {
  it('removes inline math $...$ delimiters', () => {
    const input = 'The formula is $E = mc^2$ in physics.';
    const result = stripLatex(input);
    expect(result).not.toContain('$');
  });

  it('removes display math $$...$$ blocks', () => {
    const input = 'Consider: $$x^2 + y^2 = r^2$$ which is a circle.';
    const result = stripLatex(input);
    expect(result).not.toContain('$$');
    expect(result).toContain('which is a circle');
  });

  it('replaces \\frac{a}{b} with a/b', () => {
    const input = 'The ratio is \\frac{3}{4} of the total.';
    const result = stripLatex(input);
    expect(result).toContain('3/4');
    expect(result).not.toContain('\\frac');
  });

  it('replaces \\text{...} with contents', () => {
    const input = '\\text{speed} = \\frac{\\text{distance}}{\\text{time}}';
    const result = stripLatex(input);
    expect(result).toContain('speed');
    expect(result).toContain('distance');
    expect(result).toContain('time');
    expect(result).not.toContain('\\text');
  });

  it('replaces \\sqrt{x} with sqrt(x)', () => {
    const input = 'The answer is \\sqrt{16}.';
    const result = stripLatex(input);
    expect(result).toContain('sqrt(16)');
  });

  it('removes \\displaystyle', () => {
    const input = '\\displaystyle some formula here';
    const result = stripLatex(input);
    expect(result).not.toContain('\\displaystyle');
    expect(result).toContain('some formula here');
  });

  it('replaces \\times with x', () => {
    expect(stripLatex('3 \\times 4')).toBe('3 x 4');
  });

  it('replaces \\approx with ≈', () => {
    expect(stripLatex('pi \\approx 3.14')).toBe('pi ≈ 3.14');
  });

  it('replaces \\pm with ±', () => {
    expect(stripLatex('5 \\pm 2')).toBe('5 ± 2');
  });

  it('removes remaining backslash commands', () => {
    const input = '\\alpha + \\beta = \\gamma';
    const result = stripLatex(input);
    expect(result).not.toContain('\\');
    expect(result).toBe('+ =');
  });

  it('cleans up leftover braces', () => {
    const input = 'some {leftover} braces';
    const result = stripLatex(input);
    expect(result).not.toContain('{');
    expect(result).not.toContain('}');
  });

  it('handles empty string', () => {
    expect(stripLatex('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    const input = 'Albert Einstein was a physicist.';
    expect(stripLatex(input)).toBe(input);
  });

  it('handles complex Wikipedia-style LaTeX', () => {
    const input =
      'The equation $\\displaystyle E = mc^{2}$ describes mass-energy equivalence.';
    const result = stripLatex(input);
    expect(result).not.toContain('\\displaystyle');
    expect(result).not.toContain('$');
    expect(result).toContain('describes mass-energy equivalence');
  });
});
