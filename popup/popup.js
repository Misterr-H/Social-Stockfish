import { SettingsUI } from '../ui/components/settings.js';
import { StorageService } from '../services/storage.js';

// Initialize settings
new SettingsUI();

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
        // Check if API key is configured
        const settings = await StorageService.getSettings();
        if (!settings[`${settings.selectedLLM}ApiKey`]) {
            alert(`Please configure your ${settings.selectedLLM.toUpperCase()} API key in settings`);
            return;
        }

        const button = document.getElementById('clickMe');
        const loadingIndicator = document.getElementById('loading');
        const explorationViz = document.getElementById('exploration-viz');
        const evaluationViz = document.getElementById('evaluation-viz');
        const suggestionsDiv = document.getElementById('suggestions');
        const contextDiv = document.getElementById('analysis-context');
        
        // Clear previous results and show loading state
        suggestionsDiv.innerHTML = '';
        contextDiv.innerHTML = '';
        button.disabled = true;
        loadingIndicator.style.display = 'block';
        
        // Only show simulation loading if simulations are enabled
        if (settings.simulationEnabled) {
            explorationViz.style.display = 'block';
            evaluationViz.style.display = 'block';
            explorationViz.innerHTML = '<div class="viz-loading">Exploring conversation states...</div>';
            evaluationViz.innerHTML = '<div class="viz-loading">Running Monte Carlo simulation...</div>';
        } else {
            explorationViz.style.display = 'none';
            evaluationViz.style.display = 'none';
        }

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

        const chatGoal = document.getElementById('chatGoal').value.trim();
        
        if (!chatGoal) {
            alert('Please enter your chat goal');
            return;
        }

        // Execute script in the active tab to get messages
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML
        });

        if (!results || !results[0]) {
            throw new Error('Script execution failed to return results');
        }

        const messages = extractMessages(results[0].result);
        
        console.log('Sending messages to background script:', messages);
        
        // Send messages to service worker for analysis
        const analysis = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'ANALYZE_CONVERSATION',
                messages,
                chatGoal,
                simulationEnabled: Boolean(settings.simulationEnabled)
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
        
        console.log('Analysis received:', {
            hasSimulations: analysis.simulatedResults?.length > 0,
            suggestionCount: analysis.suggestions?.length
        });
        
        // Display results
        displayResults(analysis, explorationViz, evaluationViz, contextDiv, suggestionsDiv);
        
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred: ' + error.message);
    } finally {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('clickMe').disabled = false;
    }
});

function extractMessages(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const messageElements = doc.querySelectorAll('div[data-pre-plain-text]');
    const messages = [];

    messageElements.forEach(element => {
        const preText = element.getAttribute('data-pre-plain-text');
        const match = preText.match(/\[(.*?)\] (.*?):/);
        if (match) {
            const sender = match[2].trim();
            console.log('Sender:', sender);
            const text = element.querySelector('.selectable-text')?.textContent || '';
            if (text) {
                messages.push({
                    // sender: sender === 'You' ? 'Our User' : 'Other User',
                    sender: sender,
                    text: text.trim()
                });
            }
        }
    });

    return messages;
}

function displayResults(analysis, explorationViz, evaluationViz, contextDiv, suggestionsDiv) {
    // Display context
    contextDiv.innerHTML = `
        <h3>Context Analysis</h3>
        <p>${analysis.context}</p>
    `;

    // Only show visualizations if simulations were run
    if (analysis.simulatedResults && analysis.simulatedResults.length > 0) {
        explorationViz.style.display = 'block';
        evaluationViz.style.display = 'block';
        createExplorationVisualization(explorationViz, analysis);
        createEvaluationVisualization(evaluationViz, analysis.simulatedResults);
    } else {
        explorationViz.style.display = 'none';
        evaluationViz.style.display = 'none';
    }

    // Display suggestions
    const suggestionsHtml = analysis.suggestions
        .map((suggestion, index) => {
            // Only show simulation results if they exist
            const hasSimulation = suggestion.simulatedSuccess !== null && suggestion.simulatedPaths !== null;
            
            return `
                <div class="suggestion">
                    <h3>Suggestion ${index + 1}</h3>
                    <p><strong>Response:</strong> ${suggestion.response}</p>
                    <p><strong>Expected Outcome:</strong> ${suggestion.outcome}</p>
                    <p class="probability">Initial Probability: ${suggestion.probability}%</p>
                    <p><strong>Reasoning:</strong> ${suggestion.reasoning}</p>
                    <p><strong>Tags:</strong> ${suggestion.tags.join(', ')}</p>
                    ${hasSimulation ? `
                        <p class="simulation">Simulated Success Rate: ${Math.round(suggestion.simulatedSuccess)}%</p>
                        <details>
                            <summary>View Simulation Details</summary>
                            <div class="simulation-details">
                                ${formatSimulationPaths(suggestion.simulatedPaths)}
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
    
    const rows = Math.ceil(Math.sqrt(analysis.suggestions.length * 10));
    const cols = Math.ceil((analysis.suggestions.length * 10) / rows);
    
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