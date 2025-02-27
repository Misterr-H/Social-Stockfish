export const CONFIG = {
    // API Keys (will be overridden by storage)
    CLAUDE_API_KEY: '',
    GPT4_API_KEY: '',

    // Simulation parameters
    MAX_MESSAGES_TO_SIMULATE: 3,
    MAX_CONVERSATION_PATHS: 3,
    
    // API Endpoints
    CLAUDE_API_ENDPOINT: 'https://api.anthropic.com/v1/messages',
    GPT4_API_ENDPOINT: 'https://api.openai.com/v1/chat/completions',
    
    // Model settings
    CLAUDE_MODEL: 'claude-3-sonnet-20240229',
    GPT4_MODEL: 'gpt-4o',
    
    // Rate limiting
    CLAUDE_RATE_LIMIT: {
        REQUESTS_PER_MINUTE: 5,
        WINDOW_MS: 60000
    },
    
    // Visualization settings
    VIZ: {
        DOT_SIZE: 6,
        DOT_SPACING: 12,
        SUCCESS_THRESHOLD: 70
    }
}; 