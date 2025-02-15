import { CONFIG } from './config.js';

class AIService {
    constructor() {
        this.apiKey = CONFIG.CLAUDE_API_KEY;
    }

    async analyzeConversation(messages, chatGoal) {
        try {
            const prompt = this.formatPrompt(messages, chatGoal);
            
            const headers = new Headers({
                'Content-Type': 'application/json',
                'anthropic-dangerous-direct-browser-access': true,
                'X-Api-Key': this.apiKey,
                'Anthropic-Version': '2023-06-01'
            });

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                mode: 'cors',
                credentials: 'omit',
                headers: headers,
                body: JSON.stringify({
                    model: 'claude-3-sonnet-20240229',
                    max_tokens: 1000,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }]
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.statusText}`);
            }

            const data = await response.json();
            return this.parseAnalysis(data);
        } catch (error) {
            console.error('Error analyzing conversation:', error);
            throw error;
        }
    }

    formatPrompt(messages, chatGoal) {
        const conversationHistory = messages.map(m => 
            `${m.sender}: ${m.text}`
        ).join('\n');

        return `
Given this conversation history:
${conversationHistory}

And the user's goal: ${chatGoal}

Analyze the conversation and suggest the next 3 most effective responses. 
Provide your response in JSON format strictly in the following JSON format:

{
    "analysis": {
        "context": "Brief analysis of the current conversation state",
        "suggestions": [
            {
                "response": "Suggested message text",
                "outcome": "Expected outcome of this response",
                "probability": 85,
                "reasoning": "Why this response would be effective",
                "tags": ["persuasive", "friendly", "direct"]
            }
        ],
        "overall_strategy": "Brief description of the recommended overall approach"
    }
}

Ensure:
1. Each suggestion includes all fields
2. Probability is a number between 0-100
3. Tags are relevant to the message style and intent
4. Response is strictly in the specified JSON format with no additional text
`;
    }

    parseAnalysis(apiResponse) {
        try {
            console.log('Parsing API response:', apiResponse);

            if (!apiResponse.content || !apiResponse.content[0] || !apiResponse.content[0].text) {
                throw new Error('Invalid API response structure');
            }

            // Parse the JSON from the response text
            const analysisData = JSON.parse(apiResponse.content[0].text);
            console.log('Parsed analysis data:', analysisData);

            if (!analysisData.analysis || !analysisData.analysis.suggestions) {
                throw new Error('Invalid analysis structure');
            }

            // Return structured analysis data
            return {
                context: analysisData.analysis.context,
                overall_strategy: analysisData.analysis.overall_strategy,
                suggestions: analysisData.analysis.suggestions.map(suggestion => ({
                    response: suggestion.response || '',
                    outcome: suggestion.outcome || '',
                    probability: suggestion.probability || 0,
                    reasoning: suggestion.reasoning || '',
                    tags: suggestion.tags || []
                }))
            };
        } catch (error) {
            console.error('Error parsing analysis:', error);
            throw new Error('Failed to parse analysis results: ' + error.message);
        }
    }
}

export const aiService = new AIService();

