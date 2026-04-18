import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { z } from 'zod';
import { useGemmaAgentContext } from '../../src/GemmaAgentProvider';
import { generateStructured } from '../../src/StructuredOutput';

const TC_23_1_SCHEMA = z.object({
  title: z.string(),
  date: z.string(),
  attendees: z.array(z.string()).optional(),
});

const TC_23_1_PROMPT =
  'Dinner with Priya and Arjun on Saturday 8pm at Bombay Canteen';

type Tc231State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; object: unknown; attempts: number }
  | { kind: 'err'; message: string };

const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short event title' },
    date: {
      type: 'string',
      description: 'ISO 8601 date or a natural-language date the text contains',
    },
    location: { type: 'string' },
    attendees: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['title', 'date'],
  additionalProperties: false,
} as const;

const DEFAULT_PROMPT =
  'Dinner with Priya and Arjun on Saturday 8pm at Bombay Canteen. Dress code: smart casual.';

export function StructuredTab() {
  const { engine } = useGemmaAgentContext();
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<number | null>(null);
  const [tc231, setTc231] = useState<Tc231State>({ kind: 'idle' });

  const ready = engine.isLoaded;

  const handleTc231 = async () => {
    if (!ready || tc231.kind === 'busy') return;
    setTc231({ kind: 'busy' });
    try {
      const out = await generateStructured<{
        title: string;
        date: string;
        attendees?: string[];
      }>(engine, {
        schema: TC_23_1_SCHEMA,
        prompt: TC_23_1_PROMPT,
      });
      console.log('[TC-23.1]', JSON.stringify(out));
      setTc231({ kind: 'ok', object: out.object, attempts: out.attempts });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log('[TC-23.1] error:', message);
      setTc231({ kind: 'err', message });
    }
  };

  const handleExtract = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setResult(null);
    setError(null);
    setAttempts(null);
    try {
      const out = await generateStructured<{
        title: string;
        date: string;
        location?: string;
        attendees?: string[];
      }>(engine, {
        schema: EVENT_SCHEMA as unknown as Record<string, unknown>,
        prompt,
        systemPrompt:
          'Extract a structured event from the user text. Use the exact phrasing from the input when possible.',
      });
      setResult(JSON.stringify(out.object, null, 2));
      setAttempts(out.attempts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Load the model first (Chat tab).</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.inner}>
      <Text style={styles.label}>Free text</Text>
      <TextInput
        style={styles.input}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Paste or type text describing an event..."
        placeholderTextColor="#666"
        multiline
        editable={!busy}
      />

      <TouchableOpacity
        style={[styles.btn, (busy || !ready) && styles.btnDisabled]}
        onPress={handleExtract}
        disabled={busy || !ready}
      >
        {busy ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.btnText}>Extract Event</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.label}>Schema</Text>
      <Text style={styles.code}>{JSON.stringify(EVENT_SCHEMA, null, 2)}</Text>

      {result && (
        <>
          <Text style={styles.label}>
            Parsed object{attempts ? ` (attempt ${attempts})` : ''}
          </Text>
          <Text style={styles.resultOk}>{result}</Text>
        </>
      )}

      {error && (
        <>
          <Text style={styles.label}>Error</Text>
          <Text style={styles.resultErr}>{error}</Text>
        </>
      )}

      <View style={styles.divider} />

      <Text style={styles.label}>TC-23.1 — Zod schema round-trip</Text>
      <Text style={styles.hint}>Prompt: {TC_23_1_PROMPT}</Text>
      <TouchableOpacity
        style={[
          styles.btn,
          (tc231.kind === 'busy' || !ready) && styles.btnDisabled,
        ]}
        onPress={handleTc231}
        disabled={tc231.kind === 'busy' || !ready}
      >
        {tc231.kind === 'busy' ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.btnText}>Run TC-23.1 (Zod)</Text>
        )}
      </TouchableOpacity>

      {tc231.kind === 'ok' && (
        <>
          <Text style={styles.label}>
            TC-23.1 result (attempt {tc231.attempts})
          </Text>
          <Text style={styles.resultOk}>
            {JSON.stringify(tc231.object, null, 2)}
          </Text>
        </>
      )}
      {tc231.kind === 'err' && (
        <>
          <Text style={styles.label}>TC-23.1 error</Text>
          <Text style={styles.resultErr}>{tc231.message}</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { padding: 12, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hint: { color: '#555', fontSize: 13 },
  label: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  btn: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  btnDisabled: { backgroundColor: '#555' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  code: {
    backgroundColor: '#0a0a1a',
    color: '#9ad',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: 10,
    borderRadius: 6,
    lineHeight: 16,
  },
  resultOk: {
    backgroundColor: '#0a2a10',
    color: '#b0ffb0',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: 10,
    borderRadius: 6,
    lineHeight: 18,
  },
  resultErr: {
    backgroundColor: '#3a1010',
    color: '#ff9999',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: 10,
    borderRadius: 6,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginTop: 24,
    marginBottom: 4,
  },
});
