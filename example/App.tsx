import React, { useState, useRef, useCallback } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  initLlama,
  releaseAllLlama,
  type LlamaContext,
  type TokenData,
  type NativeCompletionResult,
} from 'llama.rn';
import RNFS from 'react-native-fs';

type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success' | 'metric';
};

type ModelStatus =
  | 'idle'
  | 'checking'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error';

type ActiveTab = 'response' | 'logs';

const MODEL_FILENAME = 'gemma-4-E2B-it-Q4_K_M.gguf';

function getTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export default function App() {
  const [status, setStatus] = useState<ModelStatus>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loadProgress, setLoadProgress] = useState(0);
  const [prompt, setPrompt] = useState('What is the capital of France?');
  const [response, setResponse] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('response');
  const [metrics, setMetrics] = useState<{
    loadTimeMs?: number;
    tokensPerSec?: number;
    promptTokens?: number;
    predictedTokens?: number;
    gpu?: boolean;
  }>({});

  const contextRef = useRef<LlamaContext | null>(null);
  const logScrollRef = useRef<ScrollView>(null);

  const addLog = useCallback(
    (message: string, type: LogEntry['type'] = 'info') => {
      setLogs(prev => [...prev, { timestamp: getTimestamp(), message, type }]);
      setTimeout(
        () => logScrollRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    },
    [],
  );

  const modelPathRef = useRef<string>('');

  const getModelPath = (): string => {
    return (
      modelPathRef.current || `${RNFS.DocumentDirectoryPath}/${MODEL_FILENAME}`
    );
  };

  const checkModel = async (): Promise<boolean> => {
    const docPath = `${RNFS.DocumentDirectoryPath}/${MODEL_FILENAME}`;
    if (await RNFS.exists(docPath)) {
      modelPathRef.current = docPath;
      const stat = await RNFS.stat(docPath);
      addLog(
        `Model found (documents): ${(Number(stat.size) / 1e9).toFixed(2)} GB`,
        'success',
      );
      return true;
    }

    const tmpPath = `/data/local/tmp/${MODEL_FILENAME}`;
    if (await RNFS.exists(tmpPath)) {
      modelPathRef.current = tmpPath;
      const stat = await RNFS.stat(tmpPath);
      addLog(
        `Model found (tmp): ${(Number(stat.size) / 1e9).toFixed(2)} GB`,
        'success',
      );
      return true;
    }

    return false;
  };

  const handleLoadModel = async () => {
    try {
      setStatus('checking');
      setActiveTab('logs');
      addLog('Checking for model file...');

      const modelExists = await checkModel();
      if (!modelExists) {
        setStatus('error');
        addLog(
          `Model not found at ${getModelPath()}. Push it via adb or download manually.`,
          'error',
        );
        Alert.alert(
          'Model Not Found',
          `Please push the GGUF model to the device first.\n\nExpected: ${getModelPath()}`,
        );
        return;
      }

      setStatus('loading');
      setLoadProgress(0);
      addLog('Loading model into memory...');

      const loadStart = Date.now();

      const context = await initLlama(
        {
          model: getModelPath(),
          n_ctx: 2048,
          n_batch: 512,
          n_threads: 4,
          flash_attn_type: 'auto',
          use_mlock: true,
        },
        (progress: number) => {
          setLoadProgress(progress);
          if (progress % 25 === 0 && progress > 0) {
            addLog(`Loading: ${progress}%`);
          }
        },
      );

      const loadTimeMs = Date.now() - loadStart;
      contextRef.current = context;

      setMetrics(prev => ({
        ...prev,
        loadTimeMs,
        gpu: context.gpu,
      }));

      addLog(`Model loaded in ${(loadTimeMs / 1000).toFixed(1)}s`, 'success');
      addLog(`GPU offload: ${context.gpu ? 'YES' : 'NO'}`, 'metric');
      if (!context.gpu && context.reasonNoGPU) {
        addLog(`GPU reason: ${context.reasonNoGPU}`, 'info');
      }

      setStatus('ready');
      addLog('Ready for inference. Type a prompt and tap Send.', 'success');
    } catch (err: unknown) {
      setStatus('error');
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Load failed: ${message}`, 'error');
    }
  };

  const handleSend = async () => {
    if (!contextRef.current || !prompt.trim()) {
      return;
    }

    try {
      setStatus('generating');
      setResponse('');
      setActiveTab('response');
      addLog(`Prompt: "${prompt}"`);

      let accumulated = '';

      const result: NativeCompletionResult =
        await contextRef.current.completion(
          {
            messages: [
              {
                role: 'system',
                content:
                  'You are a helpful assistant. Answer directly and concisely.',
              },
              { role: 'user', content: prompt },
            ],
            n_predict: 512,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            stop: ['<end_of_turn>', '<eos>'],
          },
          (data: TokenData) => {
            const text = data.content ?? data.token;
            if (text) {
              accumulated += text;
              setResponse(accumulated);
            }
          },
        );

      // content = answer only (no thinking), text = raw with thinking
      setResponse(result.content || result.text);

      const timings = result.timings;
      setMetrics(prev => ({
        ...prev,
        tokensPerSec: timings.predicted_per_second,
        promptTokens: timings.prompt_n,
        predictedTokens: timings.predicted_n,
      }));

      addLog(
        `Done: ${
          timings.predicted_n
        } tokens @ ${timings.predicted_per_second.toFixed(1)} tok/s`,
        'success',
      );
      addLog(
        `Prompt eval: ${timings.prompt_n} tokens in ${timings.prompt_ms.toFixed(
          0,
        )}ms (${timings.prompt_per_second.toFixed(1)} tok/s)`,
        'metric',
      );

      if (result.tool_calls && result.tool_calls.length > 0) {
        addLog(
          `Tool calls detected: ${JSON.stringify(result.tool_calls)}`,
          'metric',
        );
      }

      setStatus('ready');
    } catch (err: unknown) {
      setStatus('ready');
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Inference failed: ${message}`, 'error');
    }
  };

  const handleRelease = async () => {
    try {
      await releaseAllLlama();
      contextRef.current = null;
      setStatus('idle');
      setMetrics({});
      setResponse('');
      addLog('Model released', 'info');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Release failed: ${message}`, 'error');
    }
  };

  const handleTestTools = async () => {
    if (!contextRef.current) {
      return;
    }

    try {
      setStatus('generating');
      setResponse('');
      setActiveTab('response');
      addLog('Testing tool calls with get_weather tool...');

      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a location',
            parameters: {
              type: 'object' as const,
              properties: {
                location: {
                  type: 'string',
                  description: 'City name',
                },
              },
              required: ['location'],
            },
          },
        },
      ];

      let accumulated = '';

      const result: NativeCompletionResult =
        await contextRef.current.completion(
          {
            messages: [
              { role: 'user', content: 'What is the weather in Tokyo?' },
            ],
            n_predict: 256,
            temperature: 0.1,
            tools,
            tool_choice: 'auto',
          },
          (data: TokenData) => {
            if (data.token) {
              accumulated += data.token;
              setResponse(accumulated);
            }
            if (data.tool_calls && data.tool_calls.length > 0) {
              addLog(
                `Streaming tool_calls: ${JSON.stringify(data.tool_calls)}`,
                'metric',
              );
            }
          },
        );

      setResponse(result.text || result.content || '(no text)');

      addLog(`Raw text: ${result.text}`, 'info');
      addLog(`Content: ${result.content}`, 'info');

      if (result.tool_calls && result.tool_calls.length > 0) {
        addLog(
          `TOOL CALLS PARSED: ${JSON.stringify(result.tool_calls, null, 2)}`,
          'success',
        );
        for (const tc of result.tool_calls) {
          addLog(
            `  -> ${tc.function.name}(${tc.function.arguments})`,
            'success',
          );
        }
      } else {
        addLog('No tool_calls in result', 'error');
        addLog(`Full result keys: ${Object.keys(result).join(', ')}`, 'info');
      }

      setStatus('ready');
    } catch (err: unknown) {
      setStatus('ready');
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Tool test failed: ${message}`, 'error');
    }
  };

  const handleBench = async () => {
    if (!contextRef.current) {
      return;
    }

    try {
      setActiveTab('logs');
      addLog('Running benchmark (pp=512, tg=128)...');
      const result = await contextRef.current.bench(512, 128, 1, 3);
      addLog(
        `Bench: PP ${result.speedPp?.toFixed(1) ?? '?'} tok/s | TG ${
          result.speedTg?.toFixed(1) ?? '?'
        } tok/s | Flash: ${result.flashAttn}`,
        'metric',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Bench failed: ${message}`, 'error');
    }
  };

  const logColors: Record<LogEntry['type'], string> = {
    info: '#888',
    error: '#FF6B6B',
    success: '#4CAF50',
    metric: '#64B5F6',
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Gemma 4 Spike</Text>
        <Text style={styles.subtitle}>llama.rn 0.12.0-rc.4 | E2B Q4_K_M</Text>
      </View>

      {/* Metrics Bar */}
      {metrics.loadTimeMs !== undefined && (
        <View style={styles.metricsBar}>
          <MetricBadge
            label="Load"
            value={`${(metrics.loadTimeMs / 1000).toFixed(1)}s`}
          />
          <MetricBadge
            label="GPU"
            value={metrics.gpu ? 'YES' : 'NO'}
            color={metrics.gpu ? '#4CAF50' : '#FF6B6B'}
          />
          {metrics.tokensPerSec !== undefined && (
            <MetricBadge
              label="Speed"
              value={`${metrics.tokensPerSec.toFixed(1)} t/s`}
            />
          )}
          {metrics.predictedTokens !== undefined && (
            <MetricBadge label="Tokens" value={`${metrics.predictedTokens}`} />
          )}
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        {status === 'idle' || status === 'error' ? (
          <TouchableOpacity style={styles.btnPrimary} onPress={handleLoadModel}>
            <Text style={styles.btnText}>Load Model</Text>
          </TouchableOpacity>
        ) : status === 'loading' || status === 'checking' ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.loadingText}>
              {status === 'checking'
                ? 'Checking...'
                : `Loading ${loadProgress}%`}
            </Text>
          </View>
        ) : (
          <View style={styles.readyControls}>
            <TouchableOpacity style={styles.btnDanger} onPress={handleRelease}>
              <Text style={styles.btnText}>Unload</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSecondary} onPress={handleBench}>
              <Text style={styles.btnText}>Bench</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnSecondary, { backgroundColor: '#7B1FA2' }]}
              onPress={handleTestTools}
            >
              <Text style={styles.btnText}>Tools</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Prompt Input */}
      {(status === 'ready' || status === 'generating') && (
        <View style={styles.promptRow}>
          <TextInput
            style={styles.input}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Enter prompt..."
            placeholderTextColor="#666"
            multiline
            editable={status !== 'generating'}
          />
          <TouchableOpacity
            style={[
              styles.btnSend,
              status === 'generating' && styles.btnDisabled,
            ]}
            onPress={handleSend}
            disabled={status === 'generating'}
          >
            {status === 'generating' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'response' && styles.tabActive]}
          onPress={() => setActiveTab('response')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'response' && styles.tabTextActive,
            ]}
          >
            Response
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
      </View>

      {/* Tab Content */}
      <View style={styles.tabContent}>
        {activeTab === 'response' ? (
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.contentScrollInner}
          >
            {response.length > 0 ? (
              <Text style={styles.responseText}>{response}</Text>
            ) : (
              <Text style={styles.placeholderText}>
                {status === 'generating'
                  ? 'Generating...'
                  : status === 'ready'
                  ? 'Send a prompt to see the response here.'
                  : 'Load the model first.'}
              </Text>
            )}
          </ScrollView>
        ) : (
          <ScrollView
            ref={logScrollRef}
            style={styles.contentScroll}
            contentContainerStyle={styles.contentScrollInner}
          >
            {logs.map((log, i) => (
              <Text
                key={i}
                style={[styles.logLine, { color: logColors[log.type] }]}
              >
                [{log.timestamp}] {log.message}
              </Text>
            ))}
            {logs.length === 0 && (
              <Text style={styles.placeholderText}>
                Tap "Load Model" to start.
              </Text>
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingTop: StatusBar.currentHeight ?? 0,
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
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
  metricsBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  badge: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
  },
  badgeLabel: {
    fontSize: 10,
    color: '#888',
    textTransform: 'uppercase',
  },
  badgeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64B5F6',
  },
  controls: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  btnPrimary: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSecondary: {
    backgroundColor: '#1565C0',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  btnDanger: {
    backgroundColor: '#c62828',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  btnSend: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    backgroundColor: '#555',
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
  readyControls: {
    flexDirection: 'row',
    gap: 12,
  },
  promptRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
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
  contentScroll: {
    flex: 1,
    padding: 12,
  },
  contentScrollInner: {
    paddingBottom: 60,
  },
  responseText: {
    color: '#E0E0E0',
    fontSize: 15,
    lineHeight: 22,
  },
  placeholderText: {
    color: '#555',
    fontSize: 14,
    fontStyle: 'italic',
  },
  logLine: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#888',
    lineHeight: 16,
    marginBottom: 2,
  },
});
