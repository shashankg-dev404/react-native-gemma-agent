# ADR-002: Function Call Format — llama.rn Native Parsing

## Status
Accepted (2026-04-05)

## Context
The SDK needs to detect when Gemma 4 wants to call a skill (function call). Gemma 4 uses non-standard `<|tool_call>` special tokens — NOT plain JSON like GPT-4. We needed to determine: do we build a custom parser, or does llama.rn handle this natively?

## Decision
**Use llama.rn's built-in tool call parsing.** No custom FunctionCallParser needed for the primary path.

### How It Works

llama.rn v0.12.0-rc.4 has a complete tool calling pipeline:

1. **Input**: Pass `tools` in OpenAI-compatible format to `completion()`:
   ```typescript
   const result = await context.completion({
     messages: [{ role: 'user', content: '...' }],
     tools: [{
       type: 'function',
       function: {
         name: 'query_wikipedia',
         description: 'Search Wikipedia',
         parameters: {
           type: 'object',
           properties: { query: { type: 'string' } },
           required: ['query']
         }
       }
     }],
     tool_choice: 'auto',
   });
   ```

2. **Processing**: llama.rn's Jinja template engine formats the chat with tool definitions. Gemma 4's chat template handles the rest.

3. **Output**: `result.tool_calls` is auto-populated:
   ```typescript
   result.tool_calls: Array<{
     type: 'function';
     function: { name: string; arguments: string };  // arguments is JSON string
     id?: string;
   }>
   ```

4. **Streaming**: `TokenData.tool_calls` is also available during streaming, so the UI can show "Calling skill..." in real-time.

5. **Content separation**: `result.content` gives text WITHOUT tool calls. `result.text` gives the raw output.

### Key Types (from llama.rn)

```typescript
// Input
type CompletionBaseParams = {
  tools?: object;                    // OpenAI-compatible tool definitions
  tool_choice?: string;              // 'auto' | 'none' | specific tool
  parallel_tool_calls?: object;      // For parallel function calling
  force_pure_content?: boolean;      // Skip tool parsing (for non-tool prompts)
};

// Output
type NativeCompletionResult = {
  text: string;                      // Raw text
  content: string;                   // Filtered text (no tool calls)
  tool_calls: Array<ToolCall>;       // Parsed tool calls
  reasoning_content: string;         // Reasoning (if any)
  // ... timings, token counts, etc.
};
```

## Consequences

### Positive
- Zero custom parsing code for the happy path
- OpenAI-compatible format — developers already know this
- Streaming support for tool calls out of the box
- Handles Gemma 4's `<|tool_call>` tokens via native PEG parser (no regex)

### Negative
- We depend on llama.rn's parser correctness (RC version)
- If the model outputs malformed tool calls, llama.rn may silently drop them
- `arguments` is a JSON string — must call `JSON.parse()` (easy to forget)

### Impact on Architecture
- **Phase 5 (FunctionCallParser)** — drastically simplified. Instead of building a full parser, we just need a thin adapter that reads `result.tool_calls` and validates against the SkillRegistry
- **Phase 2 (InferenceEngine)** — can expose `tool_calls` directly from the completion result
- **Phase 6 (Orchestrator)** — can check `result.tool_calls.length > 0` to decide whether to execute a skill

### Fallback Strategy
If llama.rn's parser fails to detect a tool call (model outputs non-standard format), the FunctionCallParser will also scan `result.text` for JSON blocks matching `{"tool_call": ...}` as a fallback.

## Alternatives Considered
| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| llama.rn native parsing | Zero code, streaming support, handles special tokens | RC dependency | **Chosen** |
| Custom regex parser for `<\|tool_call\>` | Full control | Complex, fragile, no streaming | Rejected |
| Custom JSON-only parser for `{"tool_call": ...}` | Simple | Doesn't handle Gemma 4's native format | Fallback only |
| response_format: json_schema | Structured output | Forces ALL output to JSON, not just tool calls | Not applicable |
