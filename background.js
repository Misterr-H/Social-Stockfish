import { CONFIG } from './config.js';

// Initialize message listener when the service worker starts
self.onmessage = (event) => {
    console.log('Service worker received message:', event.data);
};

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Runtime message received:', request);
    
    if (request.type === 'ANALYZE_CONVERSATION') {
        handleAnalysisRequest(request)
            .then(sendResponse)
            .catch(error => {
                console.error('Full error details:', {
                    message: error.message,
                    stack: error.stack,
                    cause: error.cause
                });
                sendResponse({ error: `${error.message} - ${error.cause || 'No additional details'}` });
            });
        return true; // Keep the message channel open
    }
});

async function handleAnalysisRequest(request) {
    try {
        console.log('Processing analysis request:', {
            messageCount: request.messages.length,
            goal: request.chatGoal
        });
        
        const analysis = await analyzeConversation(request.messages, request.chatGoal);
        console.log('Analysis complete:', analysis);
        return analysis;
    } catch (error) {
        console.error('Analysis error:', error);
        throw error;
    }
}

async function analyzeConversation(messages, chatGoal) {
    try {
        const prompt = formatPrompt(messages, chatGoal);
        console.log('Formatted prompt:', prompt);

        const requestBody = {
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1000,
            messages: [{
                role: 'user',
                content: prompt
            }]
        };

        const headers = new Headers({
            'Content-Type': 'application/json',
            'anthropic-dangerous-direct-browser-access': true,
            'X-Api-Key': CONFIG.CLAUDE_API_KEY,
            'Anthropic-Version': '2023-06-01'
        });

        console.log('Sending request to Anthropic API...');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} ${response.statusText}`, {
                cause: errorText
            });
        }

        const data = await response.json();
        console.log('Raw API response:', data);
        return parseAnalysis(data);
    } catch (error) {
        console.error('Error in analyzeConversation:', error);
        throw error;
    }
}

function formatPrompt(messages, chatGoal) {
    const conversationHistory = messages.map(m => 
        `${m.sender}: ${m.text}`
    ).join('\n');

    return `
Given this conversation history:
${conversationHistory}

And the user's goal: ${chatGoal}

Analyze the conversation and suggest the next 3 most effective responses. 
You must respond ONLY with a JSON object in the following format, with no additional text or explanation:

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

Requirements:
1. Each suggestion must include all fields exactly as shown
2. Probability must be a number between 0-100
3. Tags must be relevant to the message style and intent
4. You must respond with ONLY the JSON object, no other text
5. The JSON must be valid and properly formatted
`;
}

function parseAnalysis(apiResponse) {
    try {
        console.log('Parsing analysis from response:', apiResponse);
        
        if (!apiResponse.content || !apiResponse.content[0] || !apiResponse.content[0].text) {
            throw new Error('Invalid API response structure', {
                cause: `Response: ${JSON.stringify(apiResponse)}`
            });
        }

        // Parse the JSON response
        const analysisData = JSON.parse(apiResponse.content[0].text);
        console.log('Parsed analysis data:', JSON.stringify(analysisData, null, 2));
        
        if (!analysisData.analysis || !analysisData.analysis.suggestions) {
            throw new Error('Invalid analysis structure');
        }

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
        console.error('Error parsing analysis:', {
            message: error.message,
            cause: error.cause,
            response: apiResponse
        });
        throw new Error('Failed to parse analysis results', {
            cause: error.message
        });
    }
}

// Log when the service worker is installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
});

// Log when the service worker starts
console.log('Background script initialized');