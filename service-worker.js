// This is the main service worker file
import { CONFIG } from './config.js';
import { SimulationService } from './services/simulation.js';

const simulationService = new SimulationService();

// Export all functions that need to be accessible
export async function handleAnalysisRequest(request) {
    try {
        await simulationService.initialize();
        
        console.log('Processing analysis request:', {
            messageCount: request.messages.length,
            goal: request.chatGoal,
            simulationEnabled: request.simulationEnabled
        });
        
        // Explicitly pass the simulation setting
        const analysis = await simulationService.analyzeConversation(
            request.messages, 
            request.chatGoal,
            Boolean(request.simulationEnabled) // Ensure it's a boolean
        );
        
        console.log('Analysis complete:', {
            hasSimulations: analysis.simulatedResults?.length > 0,
            suggestionCount: analysis.suggestions?.length
        });
        
        return analysis;
    } catch (error) {
        console.error('Analysis error:', error);
        throw error;
    }
}

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
            .then(response => {
                console.log('Sending response:', response);
                sendResponse(response);
            })
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

console.log('Service worker initialized'); 