import { ClaudeService } from './claude.js';
import { GPT4Service } from './gpt4.js';
import { StorageService } from '../storage.js';

export class LLMServiceFactory {
    static async createService() {
        const settings = await StorageService.getSettings();
        
        switch (settings.selectedLLM) {
            case 'claude':
                return new ClaudeService(settings.claudeApiKey);
            case 'gpt4':
                return new GPT4Service(settings.gpt4ApiKey);
            default:
                throw new Error(`Unknown LLM type: ${settings.selectedLLM}`);
        }
    }
} 