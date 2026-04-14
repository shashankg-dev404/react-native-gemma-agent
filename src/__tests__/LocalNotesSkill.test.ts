import { AgentOrchestrator } from '../AgentOrchestrator';
import { SkillRegistry } from '../SkillRegistry';
import { KnowledgeStore } from '../KnowledgeStore';
import type {
  CompletionResult,
  Message,
  GenerateOptions,
  TokenEvent,
  AgentEvent,
  SkillManifest,
} from '../types';

// In-memory filesystem mock for react-native-fs
const mockFs: Record<string, string> = {};
const mockDirs: Set<string> = new Set();

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/docs',
  exists: jest.fn(async (path: string) => path in mockFs || mockDirs.has(path)),
  mkdir: jest.fn(async (path: string) => {
    mockDirs.add(path);
  }),
  writeFile: jest.fn(async (path: string, content: string) => {
    mockFs[path] = content;
  }),
  readFile: jest.fn(async (path: string) => {
    if (!(path in mockFs)) throw new Error(`File not found: ${path}`);
    return mockFs[path];
  }),
  readDir: jest.fn(async (dir: string) => {
    return Object.keys(mockFs)
      .filter(
        (p) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/'),
      )
      .map((p) => ({
        name: p.split('/').pop()!,
        path: p,
        size: Buffer.byteLength(mockFs[p], 'utf8'),
        isFile: () => true,
        isDirectory: () => false,
      }));
  }),
  unlink: jest.fn(async (path: string) => {
    delete mockFs[path];
  }),
  stat: jest.fn(async (path: string) => ({
    size: path in mockFs ? Buffer.byteLength(mockFs[path], 'utf8') : 0,
  })),
}));

function clearMockFs() {
  for (const key of Object.keys(mockFs)) {
    delete mockFs[key];
  }
  mockDirs.clear();
}

class MockInferenceEngine {
  isLoaded = true;
  isGenerating = false;
  private responses: CompletionResult[] = [];
  private callIndex = 0;
  generateCallArgs: Array<{ messages: Message[]; options?: GenerateOptions }> =
    [];

  pushResponse(response: Partial<CompletionResult>): void {
    this.responses.push({
      text: '',
      content: '',
      reasoning: null,
      toolCalls: [],
      timings: {
        promptTokens: 10,
        promptMs: 100,
        promptPerSecond: 100,
        predictedTokens: 20,
        predictedMs: 200,
        predictedPerSecond: 100,
      },
      stoppedEos: true,
      stoppedLimit: false,
      contextFull: false,
      ...response,
    });
  }

  async generate(
    messages: Message[],
    options?: GenerateOptions,
    _onToken?: (event: TokenEvent) => void,
  ): Promise<CompletionResult> {
    this.generateCallArgs.push({ messages, options });
    if (this.callIndex >= this.responses.length) {
      throw new Error('MockInferenceEngine: no more responses queued');
    }
    return this.responses[this.callIndex++];
  }

  getContextUsage() {
    return { used: 30, total: 4096, percent: 1 };
  }

  resetContextUsage = jest.fn();

  async stopGeneration() {}
  async unload() {}
  getInfo() {
    return { loaded: true, gpu: false, reasonNoGPU: null, description: null, nParams: null };
  }
}

function createTestNotesSkill(store: KnowledgeStore): SkillManifest {
  return {
    name: 'local_notes',
    description: 'Save, read, search, list, or delete notes on-device.',
    version: '1.0.0',
    type: 'native',
    requiresNetwork: false,
    category: 'memory',
    parameters: {
      action: { type: 'string', enum: ['save', 'read', 'search', 'list', 'delete'] },
      title: { type: 'string' },
      content: { type: 'string' },
      query: { type: 'string' },
      tags: { type: 'string' },
    },
    requiredParameters: ['action'],
    execute: async (params) => {
      const action = String(params.action ?? '');
      switch (action) {
        case 'save': {
          const title = String(params.title ?? '');
          const content = String(params.content ?? '');
          if (!title || !content) return { error: 'Both title and content are required to save a note.' };
          const tags = params.tags ? String(params.tags).split(',').map(t => t.trim()).filter(Boolean) : [];
          await store.saveNote(title, content, tags);
          return { result: `Note "${title}" saved successfully.` };
        }
        case 'read': {
          const title = String(params.title ?? '');
          if (!title) return { error: 'Title is required to read a note.' };
          const note = await store.getNote(title);
          if (!note) return { error: `No note found with title "${title}".` };
          return { result: `Title: ${note.title}\nTags: ${note.tags.join(', ') || 'none'}\n\n${note.content}` };
        }
        case 'search': {
          const query = String(params.query ?? '');
          if (!query) return { error: 'Query is required for search.' };
          const results = await store.searchNotes(query);
          if (results.length === 0) return { result: 'No matching notes found.' };
          const formatted = results.slice(0, 5).map(r => `- ${r.note.title}: ${r.note.content.slice(0, 100)}`).join('\n');
          return { result: `Found ${results.length} note(s):\n${formatted}` };
        }
        case 'list': {
          const entries = await store.listNotes();
          if (entries.length === 0) return { result: 'No notes saved yet.' };
          const formatted = entries.map(e => `- ${e.title}: ${e.preview}`).join('\n');
          return { result: `${entries.length} note(s):\n${formatted}` };
        }
        case 'delete': {
          const title = String(params.title ?? '');
          if (!title) return { error: 'Title is required to delete a note.' };
          const deleted = await store.deleteNote(title);
          if (!deleted) return { error: `No note found with title "${title}".` };
          return { result: `Note "${title}" deleted.` };
        }
        default:
          return { error: `Unknown action "${action}". Use: save, read, search, list, or delete.` };
      }
    },
  };
}

describe('local_notes skill integration', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    clearMockFs();
    store = new KnowledgeStore('/mock/docs/gemma-agent-notes');
  });

  function makeOrchestrator(engine: MockInferenceEngine) {
    const registry = new SkillRegistry();
    const skill = createTestNotesSkill(store);
    registry.registerSkill(skill);

    const orchestrator = new AgentOrchestrator(engine as any, registry);
    orchestrator.setKnowledgeStore(store);
    return orchestrator;
  }

  it('saves a note via tool call and feeds result back to model', async () => {
    const engine = new MockInferenceEngine();

    // First response: model calls local_notes save
    engine.pushResponse({
      text: '',
      content: '',
      toolCalls: [
        {
          type: 'function',
          id: 'call_1',
          function: {
            name: 'local_notes',
            arguments: JSON.stringify({
              action: 'save',
              title: 'Flight Info',
              content: 'April 15th, Delta DL1234',
              tags: 'travel',
            }),
          },
        },
      ],
    });

    // Second response: model generates final answer after seeing tool result
    engine.pushResponse({
      text: "I've saved your flight details.",
      content: "I've saved your flight details.",
    });

    const orchestrator = makeOrchestrator(engine);
    const events: AgentEvent[] = [];
    const result = await orchestrator.sendMessage(
      'Remember my flight is April 15th, Delta DL1234',
      (e) => events.push(e),
    );

    expect(result).toContain('saved');

    // Verify note was actually saved
    const note = await store.getNote('Flight Info');
    expect(note).not.toBeNull();
    expect(note!.content).toBe('April 15th, Delta DL1234');

    // Verify skill events fired
    expect(events.some((e) => e.type === 'skill_called' && e.name === 'local_notes')).toBe(true);
    expect(events.some((e) => e.type === 'skill_result')).toBe(true);
  });

  it('reads a note via tool call', async () => {
    // Pre-save a note
    await store.saveNote('Flight Info', 'April 15th, Delta DL1234', ['travel']);

    const engine = new MockInferenceEngine();

    engine.pushResponse({
      text: '',
      content: '',
      toolCalls: [
        {
          type: 'function',
          id: 'call_1',
          function: {
            name: 'local_notes',
            arguments: JSON.stringify({ action: 'read', title: 'Flight Info' }),
          },
        },
      ],
    });

    engine.pushResponse({
      text: 'Your flight is April 15th, Delta DL1234.',
      content: 'Your flight is April 15th, Delta DL1234.',
    });

    const orchestrator = makeOrchestrator(engine);
    const result = await orchestrator.sendMessage('When is my flight?');

    expect(result).toContain('April 15th');
  });

  it('injects note index into system prompt when notes exist', async () => {
    await store.saveNote('User Prefs', 'Metric units', ['prefs']);

    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'Noted.', text: 'Noted.' });

    const orchestrator = makeOrchestrator(engine);
    await orchestrator.sendMessage('hello');

    // Check the system message sent to the model contains the note index
    const systemMsg = engine.generateCallArgs[0].messages[0];
    expect(systemMsg.role).toBe('system');
    expect(systemMsg.content).toContain('## Saved Notes');
    expect(systemMsg.content).toContain('User Prefs');
  });

  it('does not inject notes section when no notes exist', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'Hi!', text: 'Hi!' });

    const orchestrator = makeOrchestrator(engine);
    await orchestrator.sendMessage('hello');

    const systemMsg = engine.generateCallArgs[0].messages[0];
    expect(systemMsg.content).not.toContain('## Saved Notes');
  });

  it('handles unknown action gracefully', async () => {
    const skill = createTestNotesSkill(store);
    const result = await skill.execute!({ action: 'unknown_action' });
    expect(result.error).toContain('Unknown action');
  });

  it('handles save without required fields', async () => {
    const skill = createTestNotesSkill(store);
    const result = await skill.execute!({ action: 'save', title: 'Test' });
    expect(result.error).toContain('required');
  });

  it('handles read of non-existent note', async () => {
    const skill = createTestNotesSkill(store);
    const result = await skill.execute!({ action: 'read', title: 'Missing' });
    expect(result.error).toContain('No note found');
  });

  it('lists notes via skill', async () => {
    await store.saveNote('Note 1', 'Content 1');
    await store.saveNote('Note 2', 'Content 2');

    const skill = createTestNotesSkill(store);
    const result = await skill.execute!({ action: 'list' });
    expect(result.result).toContain('2 note(s)');
    expect(result.result).toContain('Note 1');
    expect(result.result).toContain('Note 2');
  });

  it('searches notes via skill', async () => {
    await store.saveNote('Flight Info', 'Delta DL1234 departing JFK', ['travel']);
    await store.saveNote('Grocery', 'Milk and eggs', ['shopping']);

    const skill = createTestNotesSkill(store);
    const result = await skill.execute!({ action: 'search', query: 'flight delta' });
    expect(result.result).toContain('Flight Info');
  });

  it('deletes a note via skill', async () => {
    await store.saveNote('Temp Note', 'Will be deleted');

    const skill = createTestNotesSkill(store);
    const result = await skill.execute!({ action: 'delete', title: 'Temp Note' });
    expect(result.result).toContain('deleted');

    const note = await store.getNote('Temp Note');
    expect(note).toBeNull();
  });
});
