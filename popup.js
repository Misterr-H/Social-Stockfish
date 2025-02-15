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
        const suggestionsDiv = document.getElementById('suggestions');
        const contextDiv = document.getElementById('analysis-context');
        
        // Clear previous results
        suggestionsDiv.innerHTML = '';
        contextDiv.innerHTML = '';
        
        // Show loading state
        button.disabled = true;
        loadingIndicator.style.display = 'block';

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
        
        // Display suggestions to user
        const suggestionsHtml = analysis.suggestions
            .map((s, i) => `
                <div class="suggestion">
                    <h3>Suggestion ${i + 1}</h3>
                    <p><strong>Response:</strong> ${s.response}</p>
                    <p><strong>Likely Outcome:</strong> ${s.outcome}</p>
                    <p class="probability">Success Probability: ${s.probability}%</p>
                    <p class="reasoning"><strong>Reasoning:</strong> ${s.reasoning}</p>
                </div>
            `)
            .join('');
            
        suggestionsDiv.innerHTML = suggestionsHtml;
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred: ' + error.message);
    } finally {
        // Hide loading state
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