export class BaseProviderAdapter {
  constructor(client, toolRegistry) {
    this.client = client;
    this.toolRegistry = toolRegistry;
  }

  formatTools(_names) {
    throw new Error('Not implemented');
  }

  async callWithTools(_model, _messages, _tools, _options) {
    throw new Error('Not implemented');
  }

  parseToolCalls(_response) {
    throw new Error('Not implemented');
  }

  formatToolResults(_toolCalls, _results) {
    throw new Error('Not implemented');
  }
}


