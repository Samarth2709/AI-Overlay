# AI Assistant Backend: Web Search Tool Integration Plan

## Overview

This plan outlines the implementation of model-agnostic tool calling capabilities to enable web searching functionality in the AI Assistant backend. The system will support web search and web fetch tools across all AI providers (OpenAI, Gemini, Grok) while maintaining a clean, extensible architecture.

## Current Architecture Analysis

### Existing Components
- **Server**: `backend/src/server.js` - Fastify server with CORS and route registration
- **Chat Routes**: `backend/src/routes/chat.js` - Multi-provider chat completions with streaming
- **Provider Clients**: `backend/src/lib/` - Individual client libraries for OpenAI, Gemini, Grok
- **Conversation Store**: `backend/src/lib/conversationStore.js` - Hybrid memory/database storage
- **Database**: `backend/src/lib/database.js` - SQLite backend with conversation persistence
- **Logger**: `backend/src/lib/logger.js` - Centralized logging system

### Existing Provider Architecture
The current system already has provider-agnostic foundations:
- Provider detection logic (`getProviderForModel`)
- Message formatting per provider (`prepareMessages`)
- Unified response handling across providers
- Streaming and non-streaming support
- Usage tracking and comprehensive logging

## Tool Calling Architecture Design

### 1. Tool Registry (`backend/src/lib/toolRegistry.js`)

**Purpose**: Single source of truth for all tool definitions

The Tool Registry is the canonical catalog and runtime controller for all agent tools. It decouples how tools are defined/validated/executed from how different model providers express or call those tools. This enables a single definition of each tool (name, JSON schema, handler, metadata) to be:
- exposed to any provider in its native format (OpenAI/Grok tools, Gemini functionDeclarations) without duplicating schemas,
- centrally validated (Ajv JSON-Schema) before execution to enforce guardrails and coherent telemetry,
- executed with a consistent context (logger, conversationId, timing) and with shared cross-cutting concerns (rate limits, caching, retries),
- observed in one place for analytics (latency, success rate, top domains, error classes), and
- evolved safely (versioning, deprecation) without touching provider adapters or routes.

Key responsibilities:
- Definition authority: registers tools once with name, description, JSON-Schema, handler, and metadata (category, cache TTL, rate limits, required envs).
- Provider surfaces: renders the same tools into provider-specific specs via helper methods consumed by adapters.
- Validation and safety: validates args with JSON-Schema; applies per-tool limits (e.g., max urls) and global constraints; rejects unsafe inputs early.
- Execution pipeline: wraps handlers with standard behaviors (circuit breaker, retries/backoff, timeouts, per-conversation concurrency caps).
- Caching and rate limiting: optional in-memory/Redis caches per tool+args; token-bucket or leaky-bucket rate limiting per tool and per conversation.
- Observability: emits structured logs and aggregates timing, counts, and outcomes; records analytics to DB via `tool_executions`.
- Versioning and deprecation: allows `tool@v2` side-by-side with `tool` while adapters can target a version list.

Lifecycle in the backend:
1) Startup: registry is constructed, tools are registered (from `backend/src/tools/index.js`), Ajv validators are compiled, environment checks run (e.g., `BRAVE_API_KEY`).
2) Request planning: adapters ask the registry for a provider-native view of available tools to present to the model.
3) Tool call: when a provider asks to call a tool, the registry validates inputs, enforces policy, and executes the handler, returning normalized JSON.
4) Post-execution: results/errors are logged, optionally cached, and persisted to analytics; the normalized result is returned to the adapter for conversation injection.

Provider-facing APIs the adapters will use:
- `getOpenAITools()` / `getGrokTools()`: returns `[{ type: 'function', function: { name, description, parameters: <JSON-Schema> }}]`.
- `getGeminiTools()`: returns `{ functionDeclarations: [{ name, description, parameters: <JSON-Schema> }] }` and optional `toolConfig`.
- `normalizeCall(raw)`: converts provider-specific call into `{ id, name, args }` (adapters may also do initial parsing and then rely on registry for validation).

Validation and execution model:
- Args are validated with Ajv; defaults from schema are applied when defined.
- Sanitization hooks (e.g., URL normalization, query trimming) run before handler.
- Execution context includes `logger`, `conversationId`, `requestId`, and limits from env/metadata.
- Fail-fast on invalid args; for handler errors, return structured error JSON to be appended as a tool response message.

Caching & rate limits:
- Pluggable cache layer (start with in-memory; optional Redis later) keyed by `(toolName, normalizedArgs)` honoring `metadata.cache_ttl`.
- Per-tool rate limits (global and per-conversation) using token buckets; configurable via env and `metadata.rate_limit`.

Observability:
- Standard log events: `tool_call`, `tool_result`, `tool_error` with timings and sizes.
- Aggregation into `tool_executions` table for dashboards (success rate, p95 latency, cost proxy by API calls).

Extensibility:
- New tools only require a definition object and registration; no adapter or route changes.
- Supports experimental tools behind feature flags; registry can filter exposed tools per request.

Failure modes and fallbacks:
- Validation failure → return error payload as tool response; model can adjust args.
- Upstream API failure → retry with backoff within handler; on final failure, return structured error with hint.
- Cache corruption → bypass cache and log anomaly; self-heal on next write.
**Structure**:
```javascript
class ToolRegistry {
  constructor() {
    this.tools = new Map(); // name -> tool definition
  }
  
  register(name, definition) {
    // Register tool with schema, handler, and metadata
  }
  
  getOpenAITools() {
    // Convert to OpenAI function tools format
  }
  
  getGeminiTools() {
    // Convert to Gemini functionDeclarations format
  }
  
  getGrokTools() {
    // Convert to Grok (OpenAI-compatible) format
  }
  
  validateCall(name, args) {
    // Validate against JSON schema
  }
  
  executeCall(name, args, context) {
    // Execute tool handler with validation
  }
}
```

**Tool Definition Format**:
```javascript
{
  name: "web_search",
  description: "Search the web for current information",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      max_results: { type: "number", default: 10, maximum: 20 }
    },
    required: ["query"]
  },
  handler: async (args, context) => { /* implementation */ },
  metadata: {
    category: "web",
    rate_limit: "10/minute",
    cache_ttl: 300000 // 5 minutes
  }
}
```

### 2. Provider Adapters (`backend/src/lib/providers/`)

**Purpose**: Translate between provider-specific tool calling formats

**Files**:
- `backend/src/lib/providers/baseAdapter.js` - Abstract base class
- `backend/src/lib/providers/openaiAdapter.js` - OpenAI tool calling
- `backend/src/lib/providers/geminiAdapter.js` - Gemini function calling
- `backend/src/lib/providers/grokAdapter.js` - Grok (xAI) tool calling

**Base Adapter Interface**:
```javascript
class BaseProviderAdapter {
  constructor(client, toolRegistry) {
    this.client = client;
    this.toolRegistry = toolRegistry;
  }
  
  // Convert tools to provider format
  formatTools() { throw new Error('Not implemented'); }
  
  // Make API call with tools
  async callWithTools(model, messages, tools, options) { 
    throw new Error('Not implemented'); 
  }
  
  // Parse tool calls from response
  parseToolCalls(response) { throw new Error('Not implemented'); }
  
  // Format tool results for next API call
  formatToolResults(toolCalls, results) { 
    throw new Error('Not implemented'); 
  }
  
  // Normalize tool calls to common format
  normalizeToolCalls(rawCalls) {
    return rawCalls.map(call => ({
      id: call.id,
      name: call.name,
      args: call.args
    }));
  }
}
```

### 3. Tool Implementations (`backend/src/tools/`)

**Files**:
- `backend/src/tools/webSearch.js` - Brave Search API integration
- `backend/src/tools/webFetch.js` - URL content fetching with Readability
- `backend/src/tools/index.js` - Tool exports and registration

**Web Search Tool** (`backend/src/tools/webSearch.js`):
```javascript
import axios from 'axios';

export const webSearchTool = {
  name: "web_search",
  description: "Search the web for current information on any topic",
  schema: {
    type: "object",
    properties: {
      query: {
        type: "string", 
        description: "Search query to find relevant information"
      },
      max_results: {
        type: "number", 
        description: "Maximum number of results to return",
        default: 10,
        maximum: 20
      },
      focus: {
        type: "string",
        description: "Search focus area",
        enum: ["general", "news", "academic", "recent"],
        default: "general"
      }
    },
    required: ["query"]
  },
  
  async handler(args, context) {
    const { query, max_results = 10, focus = "general" } = args;
    const { logger, conversationId } = context;
    
    try {
      logger.info({ 
        event: 'tool_call', 
        tool: 'web_search', 
        query, 
        conversationId 
      });
      
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': process.env.BRAVE_API_KEY
        },
        params: {
          q: query,
          count: max_results,
          search_lang: 'en',
          country: 'US',
          safesearch: 'moderate',
          freshness: focus === 'recent' ? 'pd' : undefined
        }
      });
      
      const results = response.data.web?.results || [];
      const normalizedResults = results.map(result => ({
        url: result.url,
        title: result.title,
        snippet: result.description,
        published: result.age,
        favicon: result.profile?.img
      }));
      
      logger.info({ 
        event: 'tool_result', 
        tool: 'web_search', 
        results_count: normalizedResults.length,
        top_domains: [...new Set(normalizedResults.slice(0, 5).map(r => new URL(r.url).hostname))],
        conversationId 
      });
      
      return {
        results: normalizedResults,
        query: query,
        total_results: normalizedResults.length,
        search_metadata: {
          timestamp: new Date().toISOString(),
          focus: focus,
          source: 'brave'
        }
      };
      
    } catch (error) {
      logger.error({ 
        event: 'tool_error', 
        tool: 'web_search', 
        error: error.message, 
        conversationId 
      });
      
      throw new Error(`Web search failed: ${error.message}`);
    }
  },
  
  metadata: {
    category: "web",
    rate_limit: "10/minute",
    cache_ttl: 300000, // 5 minutes
    requires_api_key: "BRAVE_API_KEY"
  }
};
```

**Web Fetch Tool** (`backend/src/tools/webFetch.js`):
```javascript
import axios from 'axios';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export const webFetchTool = {
  name: "web_fetch",
  description: "Fetch and extract readable content from web pages",
  schema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string", format: "uri" },
        description: "URLs to fetch content from",
        maxItems: 5
      },
      extract_mode: {
        type: "string",
        enum: ["readable", "full", "metadata"],
        default: "readable",
        description: "Content extraction mode"
      }
    },
    required: ["urls"]
  },
  
  async handler(args, context) {
    const { urls, extract_mode = "readable" } = args;
    const { logger, conversationId } = context;
    
    const results = [];
    const MAX_CONTENT_LENGTH = 10000; // 10KB limit per page
    
    for (const url of urls.slice(0, 5)) { // Limit to 5 URLs
      try {
        logger.info({ 
          event: 'tool_call', 
          tool: 'web_fetch', 
          url, 
          conversationId 
        });
        
        const response = await axios.get(url, {
          timeout: 10000,
          maxContentLength: 1024 * 1024, // 1MB limit
          headers: {
            'User-Agent': 'AI-Assistant-Bot/1.0'
          }
        });
        
        if (extract_mode === "metadata") {
          results.push({
            url,
            title: extractTitle(response.data),
            content_type: response.headers['content-type'],
            status: "success"
          });
          continue;
        }
        
        if (extract_mode === "readable") {
          const dom = new JSDOM(response.data, { url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();
          
          if (article) {
            results.push({
              url,
              title: article.title,
              content: article.textContent.slice(0, MAX_CONTENT_LENGTH),
              excerpt: article.excerpt,
              byline: article.byline,
              length: article.length,
              status: "success"
            });
          } else {
            results.push({
              url,
              error: "Could not extract readable content",
              status: "failed"
            });
          }
        } else {
          // Full mode
          results.push({
            url,
            content: response.data.slice(0, MAX_CONTENT_LENGTH),
            content_type: response.headers['content-type'],
            status: "success"
          });
        }
        
      } catch (error) {
        logger.warn({ 
          event: 'tool_error', 
          tool: 'web_fetch', 
          url, 
          error: error.message, 
          conversationId 
        });
        
        results.push({
          url,
          error: error.message,
          status: "failed"
        });
      }
    }
    
    logger.info({ 
      event: 'tool_result', 
      tool: 'web_fetch', 
      urls_processed: results.length,
      success_count: results.filter(r => r.status === 'success').length,
      conversationId 
    });
    
    return {
      results,
      fetch_metadata: {
        timestamp: new Date().toISOString(),
        mode: extract_mode,
        total_urls: urls.length,
        processed_urls: results.length
      }
    };
  },
  
  metadata: {
    category: "web",
    rate_limit: "20/minute",
    cache_ttl: 600000 // 10 minutes
  }
};

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : 'Untitled';
}
```

### 4. Enhanced Chat Route (`backend/src/routes/chat.js`)

**Major Changes**:

1. **Tool Registry Integration**:
```javascript
import { toolRegistry } from '../lib/toolRegistry.js';
import { createProviderAdapter } from '../lib/providers/index.js';

// Initialize tools on startup
toolRegistry.registerAll();
```

2. **Tool-Aware Message Preparation**:
```javascript
function prepareMessagesWithTools(history, provider, availableTools) {
  const messages = prepareMessages(history, provider); // Existing logic
  
  // Add tool definitions based on provider
  const adapter = createProviderAdapter(provider, toolRegistry);
  const tools = adapter.formatTools(availableTools);
  
  return { messages, tools, adapter };
}
```

3. **Tool Execution Loop**:
```javascript
async function executeConversationWithTools(provider, model, messages, app, conversationId, streaming = false) {
  const adapter = createProviderAdapter(provider, toolRegistry);
  const availableTools = ['web_search', 'web_fetch'];
  const maxToolRounds = 3; // Prevent infinite loops
  
  let currentMessages = [...messages];
  let toolRounds = 0;
  
  while (toolRounds < maxToolRounds) {
    const { messages: formattedMessages, tools } = prepareMessagesWithTools(
      currentMessages, provider, availableTools
    );
    
    // Make API call with tools
    const response = await adapter.callWithTools(model, formattedMessages, tools, {
      stream: streaming
    });
    
    // Check if model wants to call tools
    const toolCalls = adapter.parseToolCalls(response);
    
    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls, return final response
      return response;
    }
    
    // Execute tool calls
    const toolResults = [];
    for (const toolCall of toolCalls) {
      try {
        // Validate and execute
        toolRegistry.validateCall(toolCall.name, toolCall.args);
        const result = await toolRegistry.executeCall(
          toolCall.name, 
          toolCall.args, 
          { logger: app.log, conversationId }
        );
        
        toolResults.push({
          id: toolCall.id,
          name: toolCall.name,
          result: result
        });
        
        // Stream tool call event for UX
        if (streaming) {
          streamToolEvent('tool_call', {
            name: toolCall.name,
            args: toolCall.args
          });
        }
        
      } catch (error) {
        app.log.error({ 
          event: 'tool_execution_error', 
          tool: toolCall.name, 
          error: error.message, 
          conversationId 
        });
        
        toolResults.push({
          id: toolCall.id,
          name: toolCall.name,
          error: error.message
        });
      }
    }
    
    // Stream tool results for UX
    if (streaming) {
      streamToolEvent('tool_result', {
        results: toolResults
      });
    }
    
    // Add tool calls and results to conversation
    currentMessages.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls
    });
    
    const toolMessages = adapter.formatToolResults(toolCalls, toolResults);
    currentMessages.push(...toolMessages);
    
    toolRounds++;
  }
  
  // If we hit max rounds, make final call without tools
  const finalResponse = await adapter.callWithTools(model, currentMessages, [], {
    stream: streaming
  });
  
  return finalResponse;
}
```

### 5. Conversation Store Enhancements

**Tool Call Storage** (`backend/src/lib/conversationStore.js`):

Add support for storing tool calls and results:
```javascript
appendMessage(conversationId, role, content, details = {}) {
  // Existing implementation...
  
  // Handle tool calls
  if (details.tool_calls) {
    entry.tool_calls = details.tool_calls;
  }
  
  // Handle tool results
  if (role === 'tool') {
    entry.tool_result = {
      name: details.tool_name,
      result: content,
      call_id: details.call_id
    };
  }
  
  // Existing implementation continues...
}
```

### 6. Database Schema Updates

**Migration** (`backend/src/lib/database.js`):

Add columns for tool calling:
```sql
-- Add tool-related columns to messages table
ALTER TABLE messages ADD COLUMN tool_calls TEXT; -- JSON string
ALTER TABLE messages ADD COLUMN tool_name TEXT;
ALTER TABLE messages ADD COLUMN tool_call_id TEXT;

-- Create tool_executions table for analytics
CREATE TABLE IF NOT EXISTS tool_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args TEXT NOT NULL, -- JSON
  result TEXT, -- JSON
  error TEXT,
  execution_time_ms INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Index for tool analytics
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_name ON tool_executions(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at ON tool_executions(created_at);
```

### 7. Streaming Enhancements

**Tool Event Streaming**:

Enhance SSE streaming to include tool events:
```javascript
function createToolAwareSSESender(reply) {
  const baseSend = createSSESender(reply);
  
  return {
    sendToken: (token) => baseSend({ type: 'token', token }),
    sendToolCall: (toolCall) => baseSend({ 
      type: 'tool_call', 
      tool: toolCall.name,
      args: toolCall.args,
      id: toolCall.id
    }),
    sendToolResult: (toolResult) => baseSend({ 
      type: 'tool_result', 
      tool: toolResult.name,
      result: toolResult.result,
      id: toolResult.id
    }),
    sendDone: (data) => baseSend({ type: 'done', ...data }),
    sendError: (error) => baseSend({ type: 'error', error })
  };
}
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
1. **Tool Registry Implementation**
   - Create `backend/src/lib/toolRegistry.js`
   - Implement tool registration and validation
   - Add provider-specific tool formatting

2. **Provider Adapters**
   - Create base adapter class
   - Implement OpenAI adapter (start here as it's most straightforward)
   - Create adapter factory

3. **Database Schema Updates**
   - Add tool-related columns
   - Create migration scripts
   - Update database.js with tool methods

### Phase 2: Tool Implementations (Week 2)
1. **Web Search Tool**
   - Implement Brave Search API integration
   - Add comprehensive error handling
   - Implement result normalization

2. **Web Fetch Tool**
   - Add axios and readability dependencies
   - Implement content extraction
   - Add safety limits and validation

3. **Tool Registration**
   - Create tools/index.js
   - Register tools in toolRegistry
   - Add environment variable validation

### Phase 3: Chat Integration (Week 3)
1. **Enhanced Chat Route**
   - Integrate tool registry into chat flow
   - Implement tool execution loop
   - Add tool call validation and error handling

2. **Streaming Updates**
   - Enhance SSE to support tool events
   - Add real-time tool call progress
   - Implement tool result streaming

3. **Conversation Store Updates**
   - Add tool call storage
   - Update message handling
   - Enhance transcript format

### Phase 4: Provider Adapters (Week 4)
1. **Gemini Adapter**
   - Implement Gemini function calling
   - Handle Gemini-specific response format
   - Add proper error handling

2. **Grok Adapter**
   - Implement xAI tool calling (OpenAI-compatible)
   - Test with Grok models
   - Ensure consistency with OpenAI adapter

3. **Testing & Integration**
   - Test all providers with both tools
   - Validate tool call formatting
   - Performance testing and optimization

## File Structure

```
backend/src/
├── lib/
│   ├── toolRegistry.js              # Tool registry and validation
│   ├── providers/
│   │   ├── index.js                 # Adapter factory
│   │   ├── baseAdapter.js           # Abstract base class
│   │   ├── openaiAdapter.js         # OpenAI tool calling
│   │   ├── geminiAdapter.js         # Gemini function calling
│   │   └── grokAdapter.js           # Grok (xAI) tool calling
│   ├── conversationStore.js         # Enhanced with tool storage
│   ├── database.js                  # Updated schema and methods
│   └── [existing files...]
├── tools/
│   ├── index.js                     # Tool exports and registration
│   ├── webSearch.js                 # Brave Search implementation
│   └── webFetch.js                  # URL fetching with Readability
├── routes/
│   ├── chat.js                      # Enhanced with tool calling
│   └── [existing files...]
└── [existing files...]
```

## Dependencies to Add

Add to `backend/package.json`:
```json
{
  "dependencies": {
    "axios": "^1.6.0",
    "@mozilla/readability": "^0.4.4",
    "jsdom": "^23.0.0",
    "ajv": "^8.12.0"
  }
}
```

## Environment Variables

Add to `.env`:
```bash
# Web Search API
BRAVE_API_KEY=your_brave_search_api_key

# Tool Configuration
TOOL_RATE_LIMIT_ENABLED=true
TOOL_CACHE_ENABLED=true
TOOL_MAX_CONCURRENT=3

# Safety Limits
WEB_FETCH_TIMEOUT=10000
WEB_FETCH_MAX_SIZE=1048576
WEB_SEARCH_MAX_RESULTS=20
```

## Error Handling Strategy

1. **Tool Validation Errors**: Return structured error to model with suggestions
2. **API Failures**: Graceful degradation with cached results if available
3. **Rate Limiting**: Queue tool calls and implement backoff
4. **Safety**: Content filtering and URL validation
5. **Logging**: Comprehensive tool execution analytics

## Security Considerations

1. **URL Validation**: Whitelist/blacklist domains for web fetch
2. **Content Filtering**: Scan fetched content for malicious code
3. **Rate Limiting**: Per-conversation and global limits
4. **API Key Security**: Proper environment variable handling
5. **Input Sanitization**: Clean search queries and URLs

## Performance Optimizations

1. **Caching**: Redis cache for search results and fetched content
2. **Concurrency**: Parallel tool execution where possible
3. **Connection Pooling**: Reuse HTTP connections
4. **Response Streaming**: Stream tool results as they complete
5. **Database Indexing**: Optimize tool execution queries

## Monitoring & Analytics

1. **Tool Usage Metrics**: Track tool call frequency and success rates
2. **Performance Monitoring**: Monitor tool execution times
3. **Error Tracking**: Log and alert on tool failures
4. **Cost Tracking**: Monitor API usage and costs
5. **User Analytics**: Track which tools are most useful

## Testing Strategy

1. **Unit Tests**: Individual tool functions and adapters
2. **Integration Tests**: End-to-end tool calling flows
3. **Provider Tests**: Test each AI provider's tool calling
4. **Load Tests**: Concurrent tool execution performance
5. **Error Tests**: Failure scenarios and recovery

This comprehensive plan provides a robust foundation for implementing web search capabilities while maintaining the existing architecture's strengths and ensuring scalability for future tool additions.
