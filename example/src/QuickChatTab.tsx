import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLLM } from '../../src';

export function QuickChatTab() {
  const {
    stream,
    isReady,
    isGenerating,
    interrupt,
    response,
    streamingText,
    error,
    reset,
  } = useLLM({ systemPrompt: 'Be concise. One paragraph max.' });

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ role: string; text: string }[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput('');
    setHistory(prev => [...prev, { role: 'user', text }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const reply = await stream(text);
      setHistory(prev => [...prev, { role: 'assistant', text: reply }]);
    } catch {
      // error state is set by the hook
    }
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  if (!isReady) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Load the model first (Chat tab).</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.label}>Quick Chat (useLLM)</Text>
        <TouchableOpacity
          onPress={() => {
            reset();
            setHistory([]);
          }}
        >
          <Text style={styles.clearBtn}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollInner}
      >
        {history.length === 0 && !streamingText && (
          <Text style={styles.hint}>No skills, no tools, just raw LLM chat.</Text>
        )}
        {history.map((msg, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            <Text style={styles.bubbleText}>{msg.text}</Text>
          </View>
        ))}
        {streamingText.length > 0 && (
          <View style={[styles.bubble, styles.bubbleAssistant]}>
            <Text style={styles.bubbleText}>{streamingText}</Text>
            <View style={styles.dot} />
          </View>
        )}
      </ScrollView>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask anything..."
          placeholderTextColor="#666"
          editable={!isGenerating}
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={styles.btn}
          onPress={isGenerating ? interrupt : handleSend}
        >
          {isGenerating ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  label: { color: '#888', fontSize: 12, fontWeight: '600' },
  clearBtn: { color: '#4CAF50', fontSize: 12, fontWeight: '600' },
  scroll: { flex: 1, padding: 12 },
  scrollInner: { paddingBottom: 20, gap: 10 },
  hint: { color: '#555', fontSize: 13, textAlign: 'center', marginTop: 30 },
  bubble: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '85%' },
  bubbleUser: { backgroundColor: '#1565C0', alignSelf: 'flex-end' },
  bubbleAssistant: { backgroundColor: '#16213e', alignSelf: 'flex-start' },
  bubbleText: { color: '#E0E0E0', fontSize: 14, lineHeight: 20 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50', marginTop: 4 },
  error: { color: '#FF6B6B', fontSize: 11, paddingHorizontal: 12, paddingBottom: 4 },
  inputRow: { flexDirection: 'row', padding: 12, gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
  },
  btn: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
