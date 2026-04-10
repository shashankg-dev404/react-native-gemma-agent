import type { SkillManifest } from '../src/types';
import { KnowledgeStore } from '../src/KnowledgeStore';

/**
 * Create a local_notes skill wired to a KnowledgeStore instance.
 * This factory is needed because the skill's execute function needs
 * a reference to the store.
 */
export function createLocalNotesSkill(store: KnowledgeStore): SkillManifest {
  return {
    name: 'local_notes',
    description:
      'Save, read, search, list, or delete notes on-device. ' +
      'Use this to remember information the user tells you, store preferences, ' +
      'or recall previously saved facts.',
    version: '1.0.0',
    type: 'native',
    requiresNetwork: false,
    category: 'memory',
    parameters: {
      action: {
        type: 'string',
        description: 'The action to perform',
        enum: ['save', 'read', 'search', 'list', 'delete'],
      },
      title: {
        type: 'string',
        description:
          'Note title (required for save, read, delete). Use descriptive, short titles.',
      },
      content: {
        type: 'string',
        description: 'Note content (required for save)',
      },
      query: {
        type: 'string',
        description: 'Search query (required for search)',
      },
      tags: {
        type: 'string',
        description:
          'Comma-separated tags for categorization (optional, used with save)',
      },
    },
    requiredParameters: ['action'],
    instructions:
      'Use this skill when the user says "remember", "save", "note", or asks you to ' +
      'recall something. For save: provide title, content, and optional tags. ' +
      'For read: provide the exact title. For search: provide a query. ' +
      'For list: no extra params needed. For delete: provide the title.',
    execute: async (params) => {
      const MAX_TITLE_LEN = 200;
      const MAX_CONTENT_LEN = 50_000;
      const MAX_TAG_LEN = 50;
      const MAX_TAGS = 20;

      if (typeof params.action !== 'string') {
        return { error: 'action must be a string.' };
      }
      const action = params.action;

      switch (action) {
        case 'save': {
          const title = String(params.title ?? '');
          const content = String(params.content ?? '');
          if (!title || !content) {
            return { error: 'Both title and content are required to save a note.' };
          }
          if (title.length > MAX_TITLE_LEN) {
            return { error: `Title too long (max ${MAX_TITLE_LEN} chars).` };
          }
          if (content.length > MAX_CONTENT_LEN) {
            return { error: `Content too long (max ${MAX_CONTENT_LEN} chars).` };
          }
          const tags = params.tags
            ? String(params.tags)
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : [];
          if (tags.length > MAX_TAGS) {
            return { error: `Too many tags (max ${MAX_TAGS}).` };
          }
          if (tags.some((t) => t.length > MAX_TAG_LEN)) {
            return { error: `Tag too long (max ${MAX_TAG_LEN} chars each).` };
          }
          try {
            await store.saveNote(title, content, tags);
            return { result: `Note "${title}" saved successfully.` };
          } catch (err) {
            return {
              error: err instanceof Error ? err.message : 'Failed to save note.',
            };
          }
        }

        case 'read': {
          const title = String(params.title ?? '');
          if (!title) {
            return { error: 'Title is required to read a note.' };
          }
          const note = await store.getNote(title);
          if (!note) {
            return { error: `No note found with title "${title}".` };
          }
          return {
            result: `Title: ${note.title}\nTags: ${note.tags.join(', ') || 'none'}\nModified: ${note.modified}\n\n${note.content}`,
          };
        }

        case 'search': {
          const query = String(params.query ?? '');
          if (!query) {
            return { error: 'Query is required for search.' };
          }
          const results = await store.searchNotes(query);
          if (results.length === 0) {
            return { result: 'No matching notes found.' };
          }
          const formatted = results
            .slice(0, 5)
            .map(
              (r) =>
                `- ${r.note.title} (relevance: ${r.score.toFixed(1)}): ${r.note.content.slice(0, 100)}`,
            )
            .join('\n');
          return { result: `Found ${results.length} note(s):\n${formatted}` };
        }

        case 'list': {
          const entries = await store.listNotes();
          if (entries.length === 0) {
            return { result: 'No notes saved yet.' };
          }
          const formatted = entries
            .map((e) => {
              const tagsStr = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : '';
              return `- ${e.title}${tagsStr}: ${e.preview}`;
            })
            .join('\n');
          return { result: `${entries.length} note(s):\n${formatted}` };
        }

        case 'delete': {
          const title = String(params.title ?? '');
          if (!title) {
            return { error: 'Title is required to delete a note.' };
          }
          const deleted = await store.deleteNote(title);
          if (!deleted) {
            return { error: `No note found with title "${title}".` };
          }
          return { result: `Note "${title}" deleted.` };
        }

        default:
          return {
            error: `Unknown action "${action}". Use: save, read, search, list, or delete.`,
          };
      }
    },
  };
}
