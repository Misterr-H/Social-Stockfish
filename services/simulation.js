import { LLMServiceFactory } from './llm/index.js';
import { CONFIG } from '../config/config.js';
import { StorageService } from './storage.js';

export class SimulationService {
    constructor() {
        this.llmService = null;
        this.simulationEnabled = true;
    }

    async initialize() {
        this.llmService = await LLMServiceFactory.createService();
    }

    async analyzeConversation(messages, chatGoal, simulationEnabled) {
        try {
            console.log('Starting analysis with simulation enabled:', simulationEnabled);
            
            const initialAnalysis = await this.getInitialAnalysis(messages, chatGoal);
            console.log('Initial analysis received');

            if (!simulationEnabled) {
                console.log('Simulations disabled, returning initial analysis only');
                return {
                    context: initialAnalysis.analysis.context,
                    suggestions: initialAnalysis.analysis.suggestions,
                    simulatedResults: []
                };
            }

            console.log('Starting parallel simulations');
            // Run all simulations in parallel
            const simulationPromises = initialAnalysis.analysis.suggestions.map(suggestion => 
                this.runParallelSimulation(messages, suggestion, chatGoal)
            );

            const simulatedResults = await Promise.all(simulationPromises);
            simulatedResults.sort((a, b) => b.averageSuccess - a.averageSuccess);

            console.log('Simulations completed');
            return {
                context: initialAnalysis.analysis.context,
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

    async getInitialAnalysis(messages, chatGoal) {
        const prompt = this.formatPrompt(messages, chatGoal);
        const response = await this.llmService.generateResponse(prompt);
        
        try {
            // Try parsing the response
            const parsedResponse = JSON.parse(response);
            
            // Validate the response structure
            if (!parsedResponse.analysis || !Array.isArray(parsedResponse.analysis.suggestions)) {
                throw new Error('Invalid response structure');
            }
            
            return parsedResponse;
        } catch (error) {
            console.error('Error parsing LLM response:', error);
            console.log('Raw response:', response);
            throw new Error('Failed to parse LLM response');
        }
    }

    async runParallelSimulation(messages, suggestion, chatGoal) {
        // Run multiple conversation paths in parallel
        const pathPromises = Array(CONFIG.MAX_CONVERSATION_PATHS).fill().map(() => 
            this.simulateConversationPath(
                [...messages, { sender: 'Our User', text: suggestion.response }],
                chatGoal,
                CONFIG.MAX_MESSAGES_TO_SIMULATE,
                0
            )
        );

        const simulationPaths = await Promise.all(pathPromises);
        const avgSuccess = this.calculateAverageSuccess(simulationPaths);

        return {
            suggestion,
            simulatedPaths: simulationPaths,
            averageSuccess: avgSuccess
        };
    }

    async simulateConversationPath(currentMessages, chatGoal, maxDepth, currentDepth) {
        if (currentDepth >= maxDepth) {
            return {
                success: this.evaluateConversationSuccess(currentMessages, chatGoal),
                path: currentMessages.slice(-2)
            };
        }

        try {
            // Simulate other user's response
            const otherUserReply = await this.simulateOtherUserReply(currentMessages);
            const updatedMessages = [...currentMessages, { sender: 'Other User', text: otherUserReply }];

            // Simulate our user's next response
            const ourResponse = await this.simulateOurResponse(updatedMessages, chatGoal);
            const finalMessages = [...updatedMessages, { sender: 'Our User', text: ourResponse }];

            // Recursively simulate next steps
            const subPath = await this.simulateConversationPath(
                finalMessages,
                chatGoal,
                maxDepth,
                currentDepth + 1
            );

            return {
                response: ourResponse,
                otherUserReply: otherUserReply,
                success: this.evaluateConversationSuccess(finalMessages, chatGoal),
                subPaths: [subPath]
            };
        } catch (error) {
            console.error('Error in conversation path:', error);
            return {
                success: this.evaluateConversationSuccess(currentMessages, chatGoal),
                error: error.message
            };
        }
    }

    async simulateOtherUserReply(messages) {
        if (!this.simulationEnabled) {
            return null;
        }
        const prompt = `Given this conversation:\n${messages.map(m => `${m.sender}: ${m.text}`).join('\n')}\n\nSimulate a realistic response from the other user:`;
        return await this.llmService.generateResponse(prompt);
    }

    async simulateOurResponse(messages, chatGoal) {
        if (!this.simulationEnabled) {
            return null;
        }
        const prompt = `Given this conversation:\n${messages.map(m => `${m.sender}: ${m.text}`).join('\n')}\n\nGoal: ${chatGoal}\n\nGenerate a response that moves towards the goal:`;
        return await this.llmService.generateResponse(prompt);
    }

    evaluateConversationSuccess(messages, chatGoal) {
        const recentMessages = messages.slice(-3);
        const goalTerms = chatGoal.toLowerCase().split(' ').filter(term => term.length > 3);
        
        const scores = {
            goalAlignment: this.calculateGoalAlignment(recentMessages.map(m => m.text).join(' '), goalTerms),
            sentiment: this.analyzeSentiment(recentMessages.map(m => m.text).join(' ')),
            engagement: this.calculateEngagement(recentMessages),
            progress: this.assessProgress(recentMessages, goalTerms)
        };
        
        const weightedScore = (
            scores.goalAlignment * 0.4 +
            scores.sentiment * 0.2 +
            scores.engagement * 0.2 +
            scores.progress * 0.2
        );
        
        return Math.round(weightedScore * 100);
    }

    calculateGoalAlignment(text, goalTerms) {
        const matches = goalTerms.filter(term => text.toLowerCase().includes(term));
        return matches.length / goalTerms.length;
    }

    analyzeSentiment(text) {
        const positiveWords = ['yes', 'agree', 'good', 'great', 'sure', 'thanks', 'appreciate', 'happy', 'perfect'];
        const negativeWords = ['no', 'disagree', 'bad', 'wrong', 'sorry', 'unfortunately', 'cannot', 'impossible'];
        
        const positiveCount = positiveWords.filter(word => text.toLowerCase().includes(word)).length;
        const negativeCount = negativeWords.filter(word => text.toLowerCase().includes(word)).length;
        
        if (positiveCount === 0 && negativeCount === 0) return 0.5;
        return positiveCount / (positiveCount + negativeCount);
    }

    calculateEngagement(messages) {
        const avgLength = messages.reduce((sum, m) => sum + m.text.length, 0) / messages.length;
        return Math.min(avgLength / 100, 1);
    }

    assessProgress(messages, goalTerms) {
        const firstHalf = messages.slice(0, Math.floor(messages.length / 2));
        const secondHalf = messages.slice(Math.floor(messages.length / 2));
        
        const firstHalfMatches = this.countGoalTerms(firstHalf, goalTerms);
        const secondHalfMatches = this.countGoalTerms(secondHalf, goalTerms);
        
        return secondHalfMatches >= firstHalfMatches ? 0.8 : 0.3;
    }

    countGoalTerms(messages, goalTerms) {
        const text = messages.map(m => m.text.toLowerCase()).join(' ');
        return goalTerms.filter(term => text.includes(term)).length;
    }

    calculateAverageSuccess(paths) {
        let totalSuccess = 0;
        let count = 0;
        
        function sumSuccessScores(path) {
            if (!path) return;
            totalSuccess += path.success || 0;
            count++;
            path.subPaths?.forEach(sumSuccessScores);
        }
        
        paths.forEach(sumSuccessScores);
        return count > 0 ? totalSuccess / count : 0;
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
}`;
    }
} 