import React, { useState, useRef, useCallback } from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  GemmaAgentProvider,
  useGemmaAgent,
  useModelDownload,
  BUILT_IN_MODELS,
  type Message,
  type AgentEvent,
} from '../src';
import { calculatorSkill } from '../skills/calculator';
import { queryWikipediaSkill } from '../skills/queryWikipedia';
import { webSearchSkill } from '../skills/webSearch';
import { deviceLocationSkill } from '../skills/deviceLocation';
import { readCalendarSkill } from '../skills/readCalendar';
import { createLocalNotesSkill } from '../skills/localNotes';
import { KnowledgeStore } from '../src/KnowledgeStore';
import { AiSdkChatTab } from './src/AiSdkChatTab';
import { QuickChatTab } from './src/QuickChatTab';
import { StructuredTab } from './src/StructuredTab';

// --- Config ---

const TESTABLE_MODELS = [
  { id: 'gemma-4-e2b-it', label: 'Gemma 4 E2B' },
  { id: 'qwen-3.5-4b', label: 'Qwen 3.5 4B' },
  { id: 'smollm2-1.7b', label: 'SmolLM2 1.7B' },
] as const;

type TestableModelId = (typeof TESTABLE_MODELS)[number]['id'];

const SYSTEM_PROMPT = `You are a helpful AI assistant running entirely on-device via Gemma 4. Answer the user directly and concisely. Do not show reasoning steps or tool evaluation. Use the tools available to you when needed.`;

const knowledgeStore = new KnowledgeStore();
const localNotesSkill = createLocalNotesSkill(knowledgeStore);

const ALL_SKILLS = [
  calculatorSkill,
  queryWikipediaSkill,
  webSearchSkill,
  deviceLocationSkill,
  readCalendarSkill,
  localNotesSkill,
];

// --- App Entry ---

export default function App() {
  const [modelId, setModelId] = useState<TestableModelId>('gemma-4-e2b-it');
  const modelFilename = BUILT_IN_MODELS[modelId].filename;

  return (
    <SafeAreaProvider>
      <GemmaAgentProvider
        key={modelId}
        model={modelId}
        skills={ALL_SKILLS}
        systemPrompt={SYSTEM_PROMPT}
        knowledgeStore={knowledgeStore}
      >
        <ChatScreen
          modelId={modelId}
          modelFilename={modelFilename}
          onSelectModel={setModelId}
        />
      </GemmaAgentProvider>
    </SafeAreaProvider>
  );
}

// --- Chat Screen ---

type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success' | 'skill';
};

type ChatScreenProps = {
  modelId: TestableModelId;
  modelFilename: string;
  onSelectModel: (id: TestableModelId) => void;
};

function ChatScreen({
  modelId,
  modelFilename,
  onSelectModel,
}: ChatScreenProps) {
  const {
    sendMessage,
    messages,
    streamingText,
    isProcessing,
    isModelLoaded,
    modelStatus,
    activeSkill,
    error,
    contextUsage,
    loadModel,
    unloadModel,
    resetConversation,
  } = useGemmaAgent();

  const {
    download,
    progress,
    status: dlStatus,
    checkModel,
    setModelPath,
  } = useModelDownload();

  const [input, setInput] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadTimeMs, setLoadTimeMs] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<
    'chat' | 'logs' | 'ai-sdk' | 'quick' | 'structured'
  >('chat');
  const [contextWarningFlash, setContextWarningFlash] = useState(false);

  const chatScrollRef = useRef<ScrollView>(null);
  const logScrollRef = useRef<ScrollView>(null);

  const addLog = useCallback(
    (message: string, type: LogEntry['type'] = 'info') => {
      const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
      setLogs(prev => [...prev, { timestamp: ts, message, type }]);
      setTimeout(
        () => logScrollRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    },
    [],
  );

  // --- Model Switching ---

  const handleSelectModel = async (nextId: TestableModelId) => {
    if (nextId === modelId) return;
    if (isModelLoaded) {
      try {
        await unloadModel();
        addLog(`Unloaded ${modelId}`, 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(`Unload failed: ${msg}`, 'error');
        return;
      }
    }
    onSelectModel(nextId);
  };

  // --- Model Loading ---

  const handleFindOrLoad = async () => {
    try {
      addLog('Searching for model on device...');
      const found = await checkModel();
      if (!found) {
        // Try /data/local/tmp/ fallback (adb push path)
        try {
          await setModelPath(`/data/local/tmp/${modelFilename}`);
          addLog('Model found at /data/local/tmp/', 'success');
        } catch {
          addLog('Model not found. Push via adb or tap Download.', 'error');
          return;
        }
      } else {
        addLog('Model found on device.', 'success');
      }

      addLog('Loading model into memory...');
      setLoadProgress(0);
      const time = await loadModel(pct => setLoadProgress(pct));
      setLoadTimeMs(time);
      addLog(`Model loaded in ${(time / 1000).toFixed(1)}s`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Load failed: ${msg}`, 'error');
    }
  };

  const handleDownload = async () => {
    try {
      addLog('Starting model download...');
      const path = await download();
      addLog(`Downloaded to: ${path}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Download failed: ${msg}`, 'error');
    }
  };

  // --- Chat ---

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isProcessing) return;

    setInput('');
    setActiveTab('chat');
    addLog(`User: "${text}"`);

    setTimeout(
      () => chatScrollRef.current?.scrollToEnd({ animated: true }),
      100,
    );

    try {
      const response = await sendMessage(text, (event: AgentEvent) => {
        switch (event.type) {
          case 'skill_called':
            addLog(
              `Calling skill: ${event.name}(${JSON.stringify(
                event.parameters,
              )})`,
              'skill',
            );
            break;
          case 'skill_result':
            addLog(
              `Skill ${event.name} returned: ${
                event.result.result?.slice(0, 100) ??
                event.result.error ??
                '(empty)'
              }`,
              'skill',
            );
            break;
          case 'context_warning':
            addLog(
              `Context window ${event.usage.percent}% full (${event.usage.used}/${event.usage.total}). Consider clearing chat.`,
              'error',
            );
            setContextWarningFlash(true);
            setTimeout(() => setContextWarningFlash(false), 5000);
            break;
          case 'error':
            addLog(`Error: ${event.error}`, 'error');
            break;
        }
      });

      addLog(`Assistant responded (${response.length} chars)`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Send failed: ${msg}`, 'error');
    }

    setTimeout(
      () => chatScrollRef.current?.scrollToEnd({ animated: true }),
      200,
    );
  };

  // --- Render ---

  const isDownloading = dlStatus === 'downloading';
  const isLoading = modelStatus === 'loading';
  const showChat = isModelLoaded;

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Gemma Agent</Text>
          <Text style={styles.subtitle}>
            on-device AI | {ALL_SKILLS.length} skills |{' '}
            {isModelLoaded ? 'ready' : modelStatus}
          </Text>
        </View>

        {/* Model Picker (test harness) */}
        <View style={styles.pickerRow}>
          {TESTABLE_MODELS.map(m => {
            const selected = m.id === modelId;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.pickerBtn, selected && styles.pickerBtnActive]}
                onPress={() => handleSelectModel(m.id)}
                disabled={isLoading || isDownloading}
              >
                <Text
                  style={[
                    styles.pickerBtnText,
                    selected && styles.pickerBtnTextActive,
                  ]}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Metrics Bar */}
        {isModelLoaded && (
          <View style={styles.metricsBar}>
            {loadTimeMs !== null && (
              <MetricBadge
                label="Load"
                value={`${(loadTimeMs / 1000).toFixed(1)}s`}
              />
            )}
            <MetricBadge label="Skills" value={`${ALL_SKILLS.length}`} />
            {activeSkill && (
              <MetricBadge label="Active" value={activeSkill} color="#FFC107" />
            )}
          </View>
        )}

        {/* Model Controls (when not loaded) */}
        {!showChat && (
          <View style={styles.controls}>
            {isDownloading && progress ? (
              <View style={styles.progressContainer}>
                <Text style={styles.progressText}>
                  Downloading... {progress.percent}%
                </Text>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${progress.percent}%` },
                    ]}
                  />
                </View>
              </View>
            ) : isLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.loadingText}>
                  Loading model... {loadProgress}%
                </Text>
              </View>
            ) : (
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={handleFindOrLoad}
                >
                  <Text style={styles.btnText}>Load Model</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={handleDownload}
                >
                  <Text style={styles.btnText}>Download</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Ready controls */}
        {showChat && (
          <View style={styles.readyRow}>
            <TouchableOpacity
              style={styles.btnSmall}
              onPress={() => {
                resetConversation();
                setContextWarningFlash(false);
                addLog('Conversation reset', 'info');
              }}
            >
              <Text style={styles.btnSmallText}>Clear Chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnSmall, styles.btnSmallDanger]}
              onPress={async () => {
                await unloadModel();
                setLoadTimeMs(null);
                addLog('Model unloaded', 'info');
              }}
            >
              <Text style={styles.btnSmallText}>Unload</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Context Usage Bar */}
        {showChat && contextUsage.total > 0 && (
          <ContextUsageBar
            used={contextUsage.used}
            total={contextUsage.total}
            percent={contextUsage.percent}
            flash={contextWarningFlash}
          />
        )}

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'chat' && styles.tabActive]}
            onPress={() => setActiveTab('chat')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'chat' && styles.tabTextActive,
              ]}
            >
              Chat
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'logs' && styles.tabActive]}
            onPress={() => setActiveTab('logs')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'logs' && styles.tabTextActive,
              ]}
            >
              Logs ({logs.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'ai-sdk' && styles.tabActive]}
            onPress={() => setActiveTab('ai-sdk')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'ai-sdk' && styles.tabTextActive,
              ]}
            >
              AI SDK
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'quick' && styles.tabActive]}
            onPress={() => setActiveTab('quick')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'quick' && styles.tabTextActive,
              ]}
            >
              Quick
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'structured' && styles.tabActive]}
            onPress={() => setActiveTab('structured')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'structured' && styles.tabTextActive,
              ]}
            >
              Struct
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        <View style={styles.tabContent}>
          {activeTab === 'ai-sdk' ? (
            <AiSdkChatTab />
          ) : activeTab === 'quick' ? (
            <QuickChatTab />
          ) : activeTab === 'structured' ? (
            <StructuredTab />
          ) : activeTab === 'chat' ? (
            <ScrollView
              ref={chatScrollRef}
              style={styles.chatScroll}
              contentContainerStyle={styles.chatScrollInner}
            >
              {messages.length === 0 && !streamingText && (
                <Text style={styles.placeholder}>
                  {showChat
                    ? 'Ask anything. Try "What is 234 * 567?" or "Search Wikipedia for quantum computing"'
                    : 'Load the model to start chatting.'}
                </Text>
              )}
              {messages
                .filter(
                  m =>
                    m.role === 'user' ||
                    (m.role === 'assistant' && !m.tool_calls?.length),
                )
                .map((msg, i) => (
                  <MessageBubble key={i} message={msg} />
                ))}
              {streamingText.length > 0 && (
                <View style={[styles.bubble, styles.bubbleAssistant]}>
                  <Text style={styles.bubbleText}>{streamingText}</Text>
                  <View style={styles.streamingDot} />
                </View>
              )}
              {activeSkill && (
                <View style={styles.skillBadge}>
                  <ActivityIndicator color="#FFC107" size="small" />
                  <Text style={styles.skillBadgeText}>
                    Running skill: {activeSkill}
                  </Text>
                </View>
              )}
            </ScrollView>
          ) : (
            <ScrollView
              ref={logScrollRef}
              style={styles.chatScroll}
              contentContainerStyle={styles.chatScrollInner}
            >
              {logs.map((log, i) => (
                <Text
                  key={i}
                  style={[styles.logLine, { color: LOG_COLORS[log.type] }]}
                >
                  [{log.timestamp}] {log.message}
                </Text>
              ))}
              {logs.length === 0 && (
                <Text style={styles.placeholder}>No logs yet.</Text>
              )}
            </ScrollView>
          )}
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Input — hidden on AI SDK tab (it ships its own input) */}
        {showChat &&
          activeTab !== 'ai-sdk' &&
          activeTab !== 'quick' &&
          activeTab !== 'structured' && (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Ask something..."
                placeholderTextColor="#666"
                multiline
                editable={!isProcessing}
                onSubmitEditing={handleSend}
              />
              <TouchableOpacity
                style={[styles.btnSend, isProcessing && styles.btnDisabled]}
                onPress={handleSend}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.btnText}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// --- Components ---

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.bubbleUser : styles.bubbleAssistant,
      ]}
    >
      <Text style={styles.bubbleRole}>{isUser ? 'You' : 'Gemma'}</Text>
      <Text style={styles.bubbleText}>{message.content}</Text>
    </View>
  );
}

function MetricBadge({
  label,
  value,
  color = '#64B5F6',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeLabel}>{label}</Text>
      <Text style={[styles.badgeValue, { color }]}>{value}</Text>
    </View>
  );
}

function ContextUsageBar({
  used,
  total,
  percent,
  flash,
}: {
  used: number;
  total: number;
  percent: number;
  flash: boolean;
}) {
  // Green < 60%, yellow 60-80%, red ≥ 80%
  const fillColor =
    percent >= 80 ? '#E53935' : percent >= 60 ? '#FFC107' : '#4CAF50';
  const clampedWidth = `${Math.min(100, Math.max(0, percent))}%` as const;
  return (
    <View style={[styles.contextBarContainer, flash && styles.contextBarFlash]}>
      <View style={styles.contextBarLabelRow}>
        <Text style={styles.contextBarLabel}>Context</Text>
        <Text style={[styles.contextBarValue, { color: fillColor }]}>
          {used.toLocaleString()} / {total.toLocaleString()} tokens ({percent}%)
        </Text>
      </View>
      <View style={styles.contextBarTrack}>
        <View
          style={[
            styles.contextBarFill,
            { width: clampedWidth, backgroundColor: fillColor },
          ]}
        />
      </View>
      {flash && (
        <Text style={styles.contextBarWarning}>
          Context window filling up — consider Clear Chat
        </Text>
      )}
    </View>
  );
}

const LOG_COLORS: Record<LogEntry['type'], string> = {
  info: '#888',
  error: '#FF6B6B',
  success: '#4CAF50',
  skill: '#FFC107',
};

// --- Styles ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingBottom: 12,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  pickerRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 6,
  },
  pickerBtn: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
  },
  pickerBtnActive: {
    backgroundColor: '#1565C0',
  },
  pickerBtnText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
  },
  pickerBtnTextActive: {
    color: '#fff',
  },
  metricsBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 10,
  },
  badge: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
  },
  badgeLabel: {
    fontSize: 9,
    color: '#888',
    textTransform: 'uppercase',
  },
  badgeValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64B5F6',
  },
  contextBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  contextBarFlash: {
    backgroundColor: '#3a1d1d',
    borderRadius: 6,
    marginHorizontal: 12,
    paddingHorizontal: 10,
  },
  contextBarLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  contextBarLabel: {
    fontSize: 10,
    color: '#888',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  contextBarValue: {
    fontSize: 11,
    fontWeight: '600',
  },
  contextBarTrack: {
    height: 4,
    backgroundColor: '#16213e',
    borderRadius: 2,
    overflow: 'hidden',
  },
  contextBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  contextBarWarning: {
    color: '#FF6B6B',
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  controls: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: '#1565C0',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
  },
  progressContainer: {
    gap: 8,
  },
  progressText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#16213e',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 3,
  },
  readyRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 8,
  },
  btnSmall: {
    backgroundColor: '#16213e',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  btnSmallDanger: {
    backgroundColor: '#4a1515',
  },
  btnSmallText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '500',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: '#111125',
  },
  tabActive: {
    backgroundColor: '#0f0f23',
    borderBottomWidth: 2,
    borderBottomColor: '#4CAF50',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#666',
  },
  tabTextActive: {
    color: '#4CAF50',
    fontWeight: '700',
  },
  tabContent: {
    flex: 1,
    marginHorizontal: 16,
    backgroundColor: '#0f0f23',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: 'hidden',
  },
  chatScroll: {
    flex: 1,
    padding: 12,
  },
  chatScrollInner: {
    paddingBottom: 20,
    gap: 10,
  },
  placeholder: {
    color: '#555',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 24,
  },
  bubble: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  bubbleUser: {
    backgroundColor: '#1565C0',
    alignSelf: 'flex-end',
  },
  bubbleAssistant: {
    backgroundColor: '#16213e',
    alignSelf: 'flex-start',
  },
  bubbleRole: {
    fontSize: 10,
    color: '#888',
    fontWeight: '600',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  bubbleText: {
    color: '#E0E0E0',
    fontSize: 14,
    lineHeight: 20,
  },
  streamingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4CAF50',
    marginTop: 4,
  },
  skillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#2a2200',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  skillBadgeText: {
    color: '#FFC107',
    fontSize: 12,
    fontWeight: '500',
  },
  errorBar: {
    backgroundColor: '#4a1515',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    maxHeight: 100,
  },
  btnSend: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    backgroundColor: '#555',
  },
  logLine: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#888',
    lineHeight: 16,
    marginBottom: 2,
  },
});
