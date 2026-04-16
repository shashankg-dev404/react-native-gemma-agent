import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  convertToModelMessages,
  jsonSchema,
  stepCountIs,
  streamText,
  tool as aiTool,
  type ChatTransport,
  type UIMessage,
} from 'ai';
import { useChat } from '@ai-sdk/react';

import { useGemmaAgentContext } from '../../src/GemmaAgentProvider';
import { SkillSandbox, type SkillSandboxHandle } from '../../src/SkillSandbox';
import { createGemmaProvider, type GemmaProvider } from '../../src/ai';
import type { SkillExecutor } from '../../src/runToolLoop';
import type { SkillRegistry } from '../../src/SkillRegistry';

type GemmaTransportOptions = {
  provider: GemmaProvider;
  registry: SkillRegistry;
  modelId?: string;
  routing?: 'all' | 'bm25';
};

function buildSkillTools(
  registry: SkillRegistry,
): Record<string, ReturnType<typeof aiTool>> {
  const tools: Record<string, ReturnType<typeof aiTool>> = {};
  for (const skill of registry.getSkills()) {
    tools[skill.name] = aiTool({
      description: skill.description,
      parameters: jsonSchema({
        type: 'object' as const,
        properties: skill.parameters,
        required: skill.requiredParameters ?? [],
      }),
    });
  }
  return tools;
}

function makeGemmaTransport({
  provider,
  registry,
  modelId = 'gemma-4-e2b',
  routing = 'all',
}: GemmaTransportOptions): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const model = provider(modelId);
      const modelMessages = await convertToModelMessages(messages);
      const skillTools = buildSkillTools(registry);
      const result = streamText({
        model,
        messages: modelMessages,
        abortSignal,
        tools: skillTools,
        stopWhen: stepCountIs(5),
        providerOptions: { gemma: { skillRouting: routing } },
      });
      return result.toUIMessageStream({ originalMessages: messages });
    },
    async reconnectToStream() {
      return null;
    },
  };
}

export function AiSdkChatTab() {
  const { engine, registry, knowledgeStore, modelManager } =
    useGemmaAgentContext();
  const sandboxRef = useRef<SkillSandboxHandle>(null);
  const [routing, setRouting] = useState<'all' | 'bm25'>('all');
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const skillExecutor: SkillExecutor = useCallback((html, params, timeout) => {
    const handle = sandboxRef.current;
    if (!handle) {
      return Promise.resolve({
        error: 'Skill sandbox not mounted yet',
      });
    }
    return handle.execute(html, params, timeout);
  }, []);

  const provider = useMemo(
    () =>
      createGemmaProvider({
        engine,
        registry,
        knowledgeStore: knowledgeStore ?? null,
        modelManager,
        skillExecutor,
      }),
    [engine, registry, knowledgeStore, modelManager, skillExecutor],
  );
  const transport = useMemo(
    () => makeGemmaTransport({ provider, registry, routing }),
    [provider, registry, routing],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming || !engine.isLoaded) return;
    setInput('');
    sendMessage({ text });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <View style={styles.container}>
      <View style={styles.routingBar}>
        <Text style={styles.routingLabel}>skillRouting:</Text>
        {(['all', 'bm25'] as const).map(opt => (
          <TouchableOpacity
            key={opt}
            onPress={() => setRouting(opt)}
            style={[
              styles.routingChip,
              routing === opt && styles.routingChipActive,
            ]}
          >
            <Text
              style={[
                styles.routingChipText,
                routing === opt && styles.routingChipTextActive,
              ]}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
        {isStreaming && (
          <TouchableOpacity onPress={() => stop()} style={styles.stopBtn}>
            <Text style={styles.stopBtnText}>Stop</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollInner}
      >
        {messages.length === 0 && (
          <Text style={styles.placeholder}>
            useChat() over createGemmaProvider. Try "What is 234 * 567?" or
            "Search Wikipedia for quantum computing".
          </Text>
        )}
        {messages.map(m => (
          <MessagePartsBubble key={m.id} message={m} />
        ))}
        {error && (
          <View style={styles.errorBubble}>
            <Text style={styles.errorText}>
              {String(error.message ?? error)}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={
            engine.isLoaded ? 'Ask something...' : 'Load the model first'
          }
          placeholderTextColor="#666"
          multiline
          editable={!isStreaming && engine.isLoaded}
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (isStreaming || !engine.isLoaded) && styles.sendBtnDisabled,
          ]}
          onPress={handleSend}
          disabled={isStreaming || !engine.isLoaded}
        >
          {isStreaming ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendBtnText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>

      <SkillSandbox ref={sandboxRef} />
    </View>
  );
}

function MessagePartsBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.bubbleUser : styles.bubbleAssistant,
      ]}
    >
      <Text style={styles.bubbleRole}>{isUser ? 'You' : 'Gemma'}</Text>
      {message.parts.map((part, i) => {
        if (part.type === 'text') {
          return (
            <Text key={i} style={styles.bubbleText}>
              {part.text}
            </Text>
          );
        }
        if (part.type.startsWith('tool-')) {
          const tool = part as {
            type: string;
            toolName?: string;
            state?: string;
            input?: unknown;
            output?: unknown;
          };
          return (
            <View key={i} style={styles.toolPart}>
              <Text style={styles.toolPartLabel}>
                tool: {tool.toolName ?? part.type}
              </Text>
              {tool.state && (
                <Text style={styles.toolPartMeta}>state: {tool.state}</Text>
              )}
              {tool.output != null && (
                <Text style={styles.toolPartOutput}>
                  {typeof tool.output === 'string'
                    ? tool.output
                    : JSON.stringify(tool.output)}
                </Text>
              )}
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  routingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
    gap: 8,
  },
  routingLabel: { color: '#888', fontSize: 12 },
  routingChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
  },
  routingChipActive: { backgroundColor: '#1976D2' },
  routingChipText: { color: '#888', fontSize: 12 },
  routingChipTextActive: { color: '#fff', fontWeight: '600' },
  stopBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#B71C1C',
  },
  stopBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollInner: { padding: 12, gap: 8 },
  placeholder: {
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 24,
  },
  bubble: {
    padding: 10,
    borderRadius: 8,
    maxWidth: '88%',
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: '#1976D2' },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: '#1a1a1a' },
  bubbleRole: { color: '#888', fontSize: 10, marginBottom: 2 },
  bubbleText: { color: '#fff', fontSize: 14 },
  toolPart: {
    marginTop: 6,
    padding: 8,
    backgroundColor: '#0d0d0d',
    borderRadius: 6,
    borderLeftWidth: 2,
    borderLeftColor: '#FFC107',
  },
  toolPartLabel: { color: '#FFC107', fontSize: 11, fontWeight: '600' },
  toolPartMeta: { color: '#666', fontSize: 10, marginTop: 2 },
  toolPartOutput: {
    color: '#ccc',
    fontSize: 12,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  errorBubble: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#3a1010',
    alignSelf: 'stretch',
  },
  errorText: { color: '#FF8A80', fontSize: 12 },
  inputRow: {
    flexDirection: 'row',
    padding: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    color: '#fff',
    padding: 10,
    borderRadius: 8,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#1976D2',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 8,
  },
  sendBtnDisabled: { backgroundColor: '#333' },
  sendBtnText: { color: '#fff', fontWeight: '600' },
});
