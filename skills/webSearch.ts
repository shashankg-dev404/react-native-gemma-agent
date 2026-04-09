import type { SkillManifest } from '../src/types';

export const webSearchSkill: SkillManifest = {
  name: 'web_search',
  description: 'Search the web for current information using SearXNG.',
  version: '2.0.0',
  type: 'js',
  requiresNetwork: true,
  category: 'research',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query',
    },
  },
  requiredParameters: ['query'],
  instructions:
    'Use this when the user asks about recent events, current information, or topics you are not sure about. Returns search results from the web.',
  html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
window['ai_edge_gallery_get_result'] = async function(jsonData) {
  var params = JSON.parse(jsonData);
  var query = params.query;
  if (!query) {
    return JSON.stringify({ error: 'No query provided' });
  }

  // SearXNG public instances to try in order
  var instances = [
    'https://searx.be',
    'https://search.bus-hit.me',
    'https://searx.tiekoetter.com'
  ];

  for (var idx = 0; idx < instances.length; idx++) {
    try {
      var url = instances[idx] + '/search?q=' + encodeURIComponent(query)
        + '&format=json&language=en&safesearch=0';
      var res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) continue;

      var data = await res.json();

      if (!data.results || data.results.length === 0) {
        // Try next instance if this one returned empty
        if (idx < instances.length - 1) continue;
        return JSON.stringify({
          result: 'No results found for "' + query + '". Try rephrasing the query.'
        });
      }

      var results = data.results.slice(0, 5).map(function(r) {
        var snippet = r.content || '';
        return r.title + ' (' + r.url + ')' + (snippet ? ': ' + snippet : '');
      }).join('\\n\\n');

      return JSON.stringify({ result: results });
    } catch (e) {
      // Try next instance on failure
      if (idx < instances.length - 1) continue;
      return JSON.stringify({ error: 'Web search failed: ' + e.message });
    }
  }

  return JSON.stringify({ error: 'All search instances unavailable.' });
};
</script>
</body>
</html>`,
};
