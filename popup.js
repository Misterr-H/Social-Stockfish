// Remove the AI service import since we'll use background script
// import { aiService } from './ai-service.js';

// Wait for the window to load before checking APIs
window.onload = () => {
    console.log('Window loaded');
    console.log('Chrome APIs available:', {
        tabs: typeof chrome.tabs !== 'undefined',
        scripting: typeof chrome.scripting !== 'undefined',
        chrome: typeof chrome !== 'undefined'
    });
};

document.getElementById('clickMe').addEventListener('click', async () => {
    try {
        const button = document.getElementById('clickMe');
        const loadingIndicator = document.getElementById('loading');
        const explorationViz = document.getElementById('exploration-viz');
        const evaluationViz = document.getElementById('evaluation-viz');
        const suggestionsDiv = document.getElementById('suggestions');
        const contextDiv = document.getElementById('analysis-context');
        
        // Clear previous results and show loading state
        suggestionsDiv.innerHTML = '';
        contextDiv.innerHTML = '';
        loadingIndicator.style.display = 'block';
        
        // Show loading animations in visualization containers
        explorationViz.innerHTML = '<div class="viz-loading">Exploring conversation states...</div>';
        evaluationViz.innerHTML = '<div class="viz-loading">Running Monte Carlo simulation...</div>';
        
        // Additional debugging
        if (!chrome.scripting) {
            throw new Error('chrome.scripting API is not available. Check manifest permissions.');
        }

        // Query the active tab in the current window
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        
        if (!tab) {
            throw new Error('No active tab found');
        }

        // Check if URL is web.whatsapp.com
        if (!tab.url.includes('web.whatsapp.com')) {
            alert('Please open WhatsApp Web to use this extension');
            return;
        }
        console.log('URL is web.whatsapp.com');

        const chatGoal = document.getElementById('chatGoal').value.trim();
        
        // Optional: Validate if chat goal is not empty
        if (!chatGoal) {
            alert('Please enter your chat goal');
            return;
        }

        // Execute script in the active tab using chrome.scripting
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML
        });

        if (!results || !results[0]) {
            throw new Error('Script execution failed to return results');
        }

        const messages = extractMessages(results[0].result);
        
        console.log('Sending messages to background script:', messages);
        
        // Check if service worker is active
        const registration = await navigator.serviceWorker.ready;
        if (!registration) {
            throw new Error('Service worker not ready');
        }
        
        // Send messages to service worker for analysis
        const analysis = await new Promise((resolve, reject) => {
            const messageChannel = new MessageChannel();
            
            messageChannel.port1.onmessage = (event) => {
                if (event.data.error) {
                    reject(new Error(event.data.error));
                } else {
                    resolve(event.data);
                }
            };
            
            chrome.runtime.sendMessage({
                type: 'ANALYZE_CONVERSATION',
                messages,
                chatGoal
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response && response.error) {
                    reject(new Error(response.error));
                    return;
                }
                resolve(response);
            });
        });
        
        console.log('Received analysis:', analysis);
        
        // Display context
        if (analysis.context) {
            contextDiv.innerHTML = `
                <h3>Context Analysis</h3>
                <p>${analysis.context}</p>
            `;
        }
        
        // Create state exploration visualization
        createExplorationVisualization(explorationViz, analysis);
        
        // Create Monte Carlo evaluation visualization
        if (analysis.simulatedResults) {
            createEvaluationVisualization(evaluationViz, analysis.simulatedResults);
        }
        
        // Display suggestions with simulation results
        displaySuggestions(analysis);
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred: ' + error.message);
    } finally {
        // Hide loading states
        document.getElementById('loading').style.display = 'none';
        document.getElementById('clickMe').disabled = false;
    }
});

function extractMessages(html) {
    // Create a new DOM parser
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Find the main container with tabindex="0" and role="application"
    const mainContainer = doc.querySelector('div[tabindex="0"][role="application"]');
    if (!mainContainer) {
        return [];
    }

    // Find all message containers
    const messageContainers = mainContainer.querySelectorAll('div[role="row"]');

    // Extract messages
    const messages = [];
    messageContainers.forEach(container => {
        const messageIn = container.querySelector('.message-in');
        const messageOut = container.querySelector('.message-out');
        const message = messageIn || messageOut;

        if (message) {
            // Update sender extraction to handle empty span with aria-label
            const senderElement = message.querySelector('span[aria-label]');
            const sender = senderElement ? senderElement.getAttribute('aria-label') : '';
            let mockSender = "You";
            if (sender.includes("You")) {
                mockSender = "Our User";
            } else {
                mockSender = "Other User";
            }
            const textElement = message.querySelector('.selectable-text');
            const timeElement = message.querySelector('.x1rg5ohu');
            const text = textElement ? textElement.textContent.trim() : '';
            const time = timeElement ? timeElement.textContent.trim() : '';

            messages.push({
                sender: mockSender,
                text,
                time
            });
        }
    });

    return messages;
}

function displaySuggestions(analysis) {
    const suggestionsDiv = document.getElementById('suggestions');
    const contextDiv = document.getElementById('analysis-context');
    const explorationViz = document.getElementById('exploration-viz');
    const evaluationViz = document.getElementById('evaluation-viz');
    
    // Clear previous visualizations
    explorationViz.innerHTML = '';
    evaluationViz.innerHTML = '';
    
    // Display context
    if (analysis.context) {
        contextDiv.innerHTML = `
            <h3>Context Analysis</h3>
            <p>${analysis.context}</p>
        `;
    }
    
    // Create state exploration visualization
    createExplorationVisualization(explorationViz, analysis);
    
    // Create Monte Carlo evaluation visualization
    if (analysis.simulatedResults) {
        createEvaluationVisualization(evaluationViz, analysis.simulatedResults);
    }
    
    // Display suggestions with simulation results
    const suggestionsHtml = analysis.suggestions
        .map((s, i) => {
            const simulationResult = analysis.simulatedResults?.[i];
            const avgSuccess = simulationResult?.averageSuccess.toFixed(1) || 'N/A';
            
            return `
                <div class="suggestion">
                    <h3>Suggestion ${i + 1}</h3>
                    <p><strong>Response:</strong> ${s.response}</p>
                    <p><strong>Likely Outcome:</strong> ${s.outcome}</p>
                    <p class="probability">Initial Success Probability: ${s.probability}%</p>
                    <p class="simulation">Simulated Success Rate: ${avgSuccess}%</p>
                    <p class="reasoning"><strong>Reasoning:</strong> ${s.reasoning}</p>
                    ${simulationResult ? `
                        <details>
                            <summary>View Simulation Details</summary>
                            <div class="simulation-details">
                                ${formatSimulationPaths(simulationResult.simulatedPaths)}
                            </div>
                        </details>
                    ` : ''}
                </div>
            `;
        })
        .join('');
        
    suggestionsDiv.innerHTML = suggestionsHtml;
}

function createExplorationVisualization(container, analysis) {
    const width = container.clientWidth;
    const height = 300;
    const dotSize = 6;
    const dotSpacing = 12;
    
    // Calculate grid dimensions
    const rows = Math.ceil(Math.sqrt(analysis.suggestions.length * 10));
    const cols = Math.ceil((analysis.suggestions.length * 10) / rows);
    
    // Create dots grid
    const dotsHtml = Array(rows).fill(0).map((_, row) => 
        Array(cols).fill(0).map((_, col) => {
            const x = (col * dotSpacing) + (dotSize / 2);
            const y = (row * dotSpacing) + (dotSize / 2);
            return `<circle 
                cx="${x}" 
                cy="${y}" 
                r="${dotSize/2}" 
                fill="#4285f4" 
                class="exploration-dot"
            />`;
        }).join('')
    ).join('');
    
    container.innerHTML = `
        <h3>Conversational State Exploration</h3>
        <svg width="${width}" height="${height}" class="exploration-svg">
            ${dotsHtml}
        </svg>
    `;
    
    // Animate dots appearing
    const dots = container.querySelectorAll('.exploration-dot');
    dots.forEach((dot, i) => {
        dot.style.opacity = '0';
        setTimeout(() => {
            dot.style.opacity = '1';
        }, i * 10);
    });
}

function createEvaluationVisualization(container, simulatedResults) {
    const width = container.clientWidth;
    const height = 300;
    const dotSize = 6;
    const dotSpacing = 12;
    
    // Create dots grid for each simulation result
    const dotsHtml = simulatedResults.map((result, resultIndex) => {
        const paths = flattenPaths(result.simulatedPaths);
        return paths.map((path, pathIndex) => {
            const x = (pathIndex * dotSpacing) + (dotSize / 2);
            const y = (resultIndex * dotSpacing * 3) + (dotSize / 2);
            const color = path.success >= 70 ? '#34A853' : '#EA4335';
            return `<circle 
                cx="${x}" 
                cy="${y}" 
                r="${dotSize/2}" 
                fill="${color}"
                class="evaluation-dot"
                data-success="${path.success}"
            />`;
        }).join('');
    }).join('');
    
    container.innerHTML = `
        <h3>Monte Carlo Evaluation</h3>
        <svg width="${width}" height="${height}" class="evaluation-svg">
            ${dotsHtml}
        </svg>
    `;
    
    // Animate dots appearing
    const dots = container.querySelectorAll('.evaluation-dot');
    dots.forEach((dot, i) => {
        dot.style.opacity = '0';
        setTimeout(() => {
            dot.style.opacity = '1';
        }, i * 20);
    });
}

function flattenPaths(paths) {
    const flattened = [];
    
    function traverse(path) {
        if (!path) return;
        flattened.push(path);
        if (path.subPaths) {
            path.subPaths.forEach(traverse);
        }
    }
    
    paths.forEach(traverse);
    return flattened;
}

function formatSimulationPaths(paths, depth = 0) {
    if (!paths || paths.length === 0) return '';
    
    return paths.map(path => `
        <div class="simulation-path" style="margin-left: ${depth * 20}px">
            <p><strong>Response:</strong> ${path.response}</p>
            <p><strong>Other User:</strong> ${path.otherUserReply}</p>
            <p><strong>Success Score:</strong> ${path.success}%</p>
            ${formatSimulationPaths(path.subPaths, depth + 1)}
        </div>
    `).join('');
}