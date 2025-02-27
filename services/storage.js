export class StorageService {
    static async getSettings() {
        const result = await chrome.storage.local.get([
            'selectedLLM',
            'claudeApiKey',
            'gpt4ApiKey',
            'simulationEnabled'
        ]);
        
        return {
            selectedLLM: result.selectedLLM || 'claude',
            claudeApiKey: result.claudeApiKey || '',
            gpt4ApiKey: result.gpt4ApiKey || '',
            simulationEnabled: result.simulationEnabled ?? true
        };
    }

    static async saveSettings(settings) {
        await chrome.storage.local.set(settings);
    }

    static async getApiKey(llmType) {
        const settings = await this.getSettings();
        switch (llmType) {
            case 'claude':
                return settings.claudeApiKey;
            case 'gpt4':
                return settings.gpt4ApiKey;
            default:
                throw new Error(`Unknown LLM type: ${llmType}`);
        }
    }
} 