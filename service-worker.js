// This is the main service worker file
import { CONFIG } from './config.js';

// Log when service worker is installed
self.addEventListener('install', (event) => {
    console.log('Service Worker installed');
    self.skipWaiting(); // Ensure the service worker activates immediately
});

// Log when service worker is activated
self.addEventListener('activate', (event) => {
    console.log('Service Worker activated');
    event.waitUntil(clients.claim()); // Take control of all clients
});

// Handle messages from popup
self.addEventListener('message', (event) => {
    console.log('Service Worker received message:', event.data);
});

// Handle runtime messages
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
        const conversationHistory = messages.map(m => 
            `${m.sender}: ${m.text}`
        ).join('\n');

        const prompt = `
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
                "reasoning": "Why this response would be effective"
            }
        ]
    }
}

Ensure each suggestion includes all fields and probability is a number between 0-100.
Do not include any other text or formatting in your response except for the JSON format.
`;

        console.log('Preparing API request with config:', {
            apiKey: CONFIG.CLAUDE_API_KEY ? 'Present' : 'Missing',
            historyLength: conversationHistory.length,
            promptLength: prompt.length
        });

        const requestBody = {
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1000,
            messages: [{
                role: 'user',
                content: prompt
            }],
            // response_format: { type: "json" }  // Request JSON response
        };

        console.log('Sending request to Anthropic API with body:', JSON.stringify(requestBody, null, 2));
        
        // Create headers object first
        const headers = new Headers({
            'Content-Type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
            'X-Api-Key': CONFIG.CLAUDE_API_KEY,
            'Anthropic-Version': '2023-06-01'
        });

        // Log headers to verify they're set
        console.log('Request headers:', [...headers.entries()]);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            mode: 'cors',  // Explicitly set CORS mode
            credentials: 'omit',  // Don't send credentials
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        // Log response headers
        console.log('Response headers:', [...response.headers.entries()]);

        const responseText = await response.text(); // Get raw response text
        console.log('Raw API Response:', responseText);

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`, {
                cause: responseText
            });
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            throw new Error('Failed to parse API response', {
                cause: `Status: ${response.status}, Raw response: ${responseText}`
            });
        }

        console.log('Parsed API response:', data);
        return parseAnalysis(data);
    } catch (error) {
        console.error('Detailed error in analyzeConversation:', {
            message: error.message,
            cause: error.cause,
            stack: error.stack
        });
        throw error;
    }
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
            suggestions: analysisData.analysis.suggestions.map(suggestion => ({
                response: suggestion.response || '',
                outcome: suggestion.outcome || '',
                probability: suggestion.probability || 0,
                reasoning: suggestion.reasoning || ''
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