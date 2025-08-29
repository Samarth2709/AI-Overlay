import { webSearchTool } from './webSearch.js';
import { webFetchTool } from './webFetch.js';
import { toolRegistry } from '../lib/toolRegistry.js';

export function registerAllTools() {
  toolRegistry.register('web_search', webSearchTool);
  toolRegistry.register('web_fetch', webFetchTool);
}

export { webSearchTool, webFetchTool };


