import type { SkillManifest } from '../src/types';

export const queryWikipediaSkill: SkillManifest = {
  name: 'query_wikipedia',
  description: 'Search Wikipedia for factual information about any topic.',
  version: '1.1.0',
  type: 'js',
  requiresNetwork: true,
  category: 'research',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query to send to Wikipedia',
    },
  },
  requiredParameters: ['query'],
  instructions:
    'Use this when the user asks a factual question you are not confident about. Pass a clear, concise search query. Use the returned information to answer naturally.',
  html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
function stripLatex(text) {
  if (!text) return text;
  // Remove display math $$...$$
  text = text.replace(/\\$\\$[^$]*\\$\\$/g, '');
  // Remove inline math $...$  (but not dollar amounts like $5)
  text = text.replace(/\\$[^$\\d][^$]*\\$/g, '');
  // Replace \\frac{a}{b} with a/b
  text = text.replace(/\\\\frac\\{([^}]*)\\}\\{([^}]*)\\}/g, '$1/$2');
  // Replace \\text{...}, \\mathrm{...}, etc. with contents
  text = text.replace(/\\\\(text|mathrm|mathbf|mathit|mathbb|mathcal|operatorname)\\{([^}]*)\\}/g, '$2');
  // Replace \\sqrt{x} with sqrt(x)
  text = text.replace(/\\\\sqrt\\{([^}]*)\\}/g, 'sqrt($1)');
  // Remove \\displaystyle and similar
  text = text.replace(/\\\\(displaystyle|textstyle|scriptstyle|left|right|Big|big)\\s*/g, '');
  // Replace common symbols
  text = text.replace(/\\\\times/g, 'x');
  text = text.replace(/\\\\cdot/g, '*');
  text = text.replace(/\\\\approx/g, '≈');
  text = text.replace(/\\\\pm/g, '±');
  text = text.replace(/\\\\leq/g, '<=');
  text = text.replace(/\\\\geq/g, '>=');
  text = text.replace(/\\\\neq/g, '!=');
  text = text.replace(/\\\\infty/g, 'infinity');
  text = text.replace(/\\\\sum/g, 'sum');
  text = text.replace(/\\\\int/g, 'integral');
  // Remove remaining \\command patterns
  text = text.replace(/\\\\[a-zA-Z]+/g, '');
  // Clean up leftover braces
  text = text.replace(/[{}]/g, '');
  // Clean up extra whitespace
  text = text.replace(/\\s+/g, ' ').trim();
  return text;
}

window['ai_edge_gallery_get_result'] = async function(jsonData) {
  const params = JSON.parse(jsonData);
  const query = params.query;
  if (!query) {
    return JSON.stringify({ error: 'No query provided' });
  }

  try {
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
      + encodeURIComponent(query);
    const res = await fetch(url);

    if (!res.ok) {
      // Try search API as fallback
      const searchUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch='
        + encodeURIComponent(query) + '&format=json&origin=*&srlimit=3';
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();
      const results = searchData.query?.search;
      if (!results || results.length === 0) {
        return JSON.stringify({ error: 'No Wikipedia results found for: ' + query });
      }
      const snippets = results.map(function(r) {
        return r.title + ': ' + stripLatex(r.snippet.replace(/<[^>]*>/g, ''));
      }).join('\\n\\n');
      return JSON.stringify({ result: snippets });
    }

    const data = await res.json();
    const title = data.title || query;
    const extract = stripLatex(data.extract || 'No summary available.');
    return JSON.stringify({ result: title + ': ' + extract });
  } catch (e) {
    return JSON.stringify({ error: 'Wikipedia lookup failed: ' + e.message });
  }
};
</script>
</body>
</html>`,
};
