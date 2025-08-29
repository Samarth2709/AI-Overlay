import Ajv from 'ajv';

/**
 * Tool Registry
 * Single source of truth for tool definitions, validation and execution.
 */
class ToolRegistry {
  constructor(options = {}) {
    this.tools = new Map();
    this.ajv = new Ajv({ useDefaults: true, removeAdditional: 'failing' });
    this.validators = new Map();
    this.cache = new Map(); // simple in-memory cache; can be swapped with Redis later
  }

  register(name, definition) {
    if (!name || !definition) throw new Error('Tool name and definition required');
    const def = { ...definition, name };
    const validate = this.ajv.compile(def.schema || { type: 'object' });
    this.tools.set(name, def);
    this.validators.set(name, validate);
  }

  get(name) {
    return this.tools.get(name);
  }

  list() {
    return Array.from(this.tools.values());
  }

  // Provider surface helpers
  getOpenAITools(names) {
    const tools = this._select(names);
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema
      }
    }));
  }

  getGrokTools(names) {
    // Grok (xAI) is OpenAI-compatible
    return this.getOpenAITools(names);
  }

  getGeminiTools(names) {
    const tools = this._select(names);
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.schema
      }))
    }];
  }

  validateCall(name, args) {
    const validate = this.validators.get(name);
    if (!validate) throw new Error(`Unknown tool: ${name}`);
    const valid = validate(args || {});
    if (!valid) {
      const message = validate.errors?.map(e => `${e.instancePath || e.schemaPath} ${e.message}`).join('; ');
      const err = new Error(`Invalid arguments for ${name}: ${message}`);
      err.validationErrors = validate.errors;
      throw err;
    }
    return true;
  }

  async executeCall(name, args, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    // Basic cache support
    const cacheKey = this._cacheKey(name, args);
    const ttl = tool.metadata?.cache_ttl;
    if (ttl) {
      const hit = this.cache.get(cacheKey);
      if (hit && (Date.now() - hit.at) < ttl) {
        return hit.data;
      }
    }

    const startedAt = Date.now();
    try {
      const result = await tool.handler(args, context);
      if (ttl) this.cache.set(cacheKey, { at: Date.now(), data: result });
      context.logger?.info({ event: 'tool_exec_ok', tool: name, ms: Date.now() - startedAt });
      return result;
    } catch (error) {
      context.logger?.error({ event: 'tool_exec_error', tool: name, ms: Date.now() - startedAt, error: error.message });
      throw error;
    }
  }

  _cacheKey(name, args) {
    return `${name}:${JSON.stringify(args || {})}`;
  }

  _select(names) {
    const list = this.list();
    if (!names || names.length === 0) return list;
    const wanted = new Set(names);
    return list.filter(t => wanted.has(t.name));
  }
}

export const toolRegistry = new ToolRegistry();


