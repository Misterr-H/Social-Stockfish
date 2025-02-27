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
        // First, get initial suggestions from Claude
        const initialAnalysis = await getInitialAnalysis(messages, chatGoal);
        console.log('Initial analysis:', initialAnalysis);

        // For each suggestion, run Monte Carlo simulation
        const simulatedResults = await Promise.all(
            initialAnalysis.suggestions.map(async (suggestion) => {
                const simulationPaths = await runMonteCarloSimulation(
                    messages,
                    suggestion,
                    chatGoal,
                    CONFIG.MAX_MESSAGES_TO_SIMULATE,
                    CONFIG.MAX_CONVERSATION_PATHS
                );
                
                // Calculate average success rate for this suggestion
                const avgSuccess = calculateAverageSuccess(simulationPaths);
                
                return {
                    suggestion,
                    simulatedPaths: simulationPaths,
                    averageSuccess: avgSuccess
                };
            })
        );

        // Sort suggestions by simulation success rate
        simulatedResults.sort((a, b) => b.averageSuccess - a.averageSuccess);

        // Return enhanced analysis with simulation results
        return {
            context: initialAnalysis.context,
            suggestions: simulatedResults.map(result => ({
                ...result.suggestion,
                simulatedSuccess: result.averageSuccess,
                simulatedPaths: result.simulatedPaths
            })),
            simulatedResults: simulatedResults
        };
    } catch (error) {
        console.error('Error in analyzeConversation:', error);
        throw error;
    }
}

async function getInitialAnalysis(messages, chatGoal) {
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
}

async function runMonteCarloSimulation(messages, suggestion, chatGoal, maxDepth, numPaths) {
    console.log('Starting Monte Carlo simulation for:', suggestion.response);
    
    const simulationPaths = [];
    const initialState = [...messages, { sender: 'Our User', text: suggestion.response }];

    // Run multiple parallel simulations
    for (let i = 0; i < numPaths; i++) {
        try {
            const path = await simulateConversationPath(
                initialState,
                chatGoal,
                maxDepth,
                0
            );
            simulationPaths.push(path);
        } catch (error) {
            console.error('Error in simulation path:', error);
        }
    }

    return simulationPaths;
}

async function simulateConversationPath(currentMessages, chatGoal, maxDepth, currentDepth) {
    if (currentDepth >= maxDepth) {
        return {
            success: evaluateConversationSuccess(currentMessages, chatGoal),
            path: currentMessages.slice(-2)
        };
    }

    try {
        // Simulate other user's response
        const otherUserReply = await simulateOtherUserReply(currentMessages);
        const updatedMessages = [...currentMessages, { sender: 'Other User', text: otherUserReply }];

        // Simulate our user's next response
        const ourResponse = await simulateOurResponse(updatedMessages, chatGoal);
        const finalMessages = [...updatedMessages, { sender: 'Our User', text: ourResponse }];

        // Recursively simulate next steps
        const subPath = await simulateConversationPath(
            finalMessages,
            chatGoal,
            maxDepth,
            currentDepth + 1
        );

        return {
            response: ourResponse,
            otherUserReply: otherUserReply,
            success: subPath.success,
            subPaths: [subPath]
        };
    } catch (error) {
        console.error('Error in simulation step:', error);
        return {
            success: evaluateConversationSuccess(currentMessages, chatGoal),
            error: error.message
        };
    }
}

async function simulateOtherUserReply(messages) {
    const prompt = `
Given this conversation history:
${messages.map(m => `${m.sender}: ${m.text}`).join('\n')}

Simulate a realistic reply from the other person. Consider their previous responses and communication style.
Respond with only the simulated message, no additional explanation.`;

    const response = await callClaudeAPI(prompt, 150);
    return response.trim();
}

async function simulateOurResponse(messages, chatGoal) {
    const prompt = `
Given this conversation history:
${messages.map(m => `${m.sender}: ${m.text}`).join('\n')}

Goal: ${chatGoal}

Suggest a single response that would be most effective in achieving the goal.
Respond with only the message text, no additional explanation.`;

    const response = await callClaudeAPI(prompt, 150);
    return response.trim();
}

function evaluateConversationSuccess(messages, chatGoal) {
    // Get the last few messages for evaluation
    const recentMessages = messages.slice(-Math.min(3, messages.length));
    const combinedText = recentMessages.map(m => m.text).join(' ').toLowerCase();
    
    // Extract key terms from the goal
    const goalTerms = chatGoal.toLowerCase().split(/\s+/);
    
    // Calculate different aspects of success
    const scores = {
        // Goal alignment: How many goal terms are present in the conversation
        goalAlignment: calculateGoalAlignment(combinedText, goalTerms),
        
        // Sentiment: Positive/negative tone of the conversation
        sentiment: analyzeSentiment(combinedText),
        
        // Engagement: Length and complexity of responses
        engagement: calculateEngagement(recentMessages),
        
        // Progress: Are we moving towards the goal
        progress: assessProgress(recentMessages, goalTerms)
    };
    
    // Weight and combine scores
    const weightedScore = (
        scores.goalAlignment * 0.4 +
        scores.sentiment * 0.2 +
        scores.engagement * 0.2 +
        scores.progress * 0.2
    );
    
    return Math.round(weightedScore * 100);
}

function calculateGoalAlignment(text, goalTerms) {
    const matches = goalTerms.filter(term => text.includes(term));
    return matches.length / goalTerms.length;
}

function analyzeSentiment(text) {
    const positiveWords = ['yes', 'agree', 'good', 'great', 'sure', 'thanks', 'appreciate', 'happy', 'perfect'];
    const negativeWords = ['no', 'disagree', 'bad', 'wrong', 'sorry', 'unfortunately', 'cannot', 'impossible'];
    
    const positiveCount = positiveWords.filter(word => text.includes(word)).length;
    const negativeCount = negativeWords.filter(word => text.includes(word)).length;
    
    if (positiveCount === 0 && negativeCount === 0) return 0.5;
    return positiveCount / (positiveCount + negativeCount);
}

function calculateEngagement(messages) {
    const avgLength = messages.reduce((sum, m) => sum + m.text.length, 0) / messages.length;
    return Math.min(avgLength / 100, 1); // Normalize to 0-1
}

function assessProgress(messages, goalTerms) {
    // Check if later messages contain more goal terms than earlier ones
    const firstHalf = messages.slice(0, Math.floor(messages.length / 2));
    const secondHalf = messages.slice(Math.floor(messages.length / 2));
    
    const firstHalfMatches = countGoalTerms(firstHalf, goalTerms);
    const secondHalfMatches = countGoalTerms(secondHalf, goalTerms);
    
    return secondHalfMatches >= firstHalfMatches ? 0.8 : 0.3;
}

function countGoalTerms(messages, goalTerms) {
    const text = messages.map(m => m.text.toLowerCase()).join(' ');
    return goalTerms.filter(term => text.includes(term)).length;
}

async function callClaudeAPI(prompt, maxTokens = 1000) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'anthropic-dangerous-direct-browser-access': true,
            'X-Api-Key': CONFIG.CLAUDE_API_KEY,
            'Anthropic-Version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-3-sonnet-20240229',
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
}

function calculateAverageSuccess(paths) {
    let totalSuccess = 0;
    let count = 0;
    
    function sumSuccessScores(path) {
        totalSuccess += path.success;
        count++;
        path.subPaths?.forEach(sumSuccessScores);
    }
    
    paths.forEach(sumSuccessScores);
    return count > 0 ? totalSuccess / count : 0;
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