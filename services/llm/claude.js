export class ClaudeService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.requestCount = 0;
        this.lastRequestTime = 0;
    }

    async checkRateLimit() {
        const now = Date.now();
        if (now - this.lastRequestTime < 60000) { // Within last minute
            if (this.requestCount >= 5) {
                const waitTime = 60000 - (now - this.lastRequestTime);
                throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(waitTime/1000)} seconds.`);
            }
        } else {
            this.requestCount = 0;
            this.lastRequestTime = now;
        }
        this.requestCount++;
    }

    async generateResponse(prompt, maxTokens = 1000) {
        await this.checkRateLimit();

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-dangerous-direct-browser-access': true,
                'X-Api-Key': this.apiKey,
                'Anthropic-Version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-sonnet-20240229',
                max_tokens: maxTokens,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            throw new Error(`Claude API request failed: ${response.status}`);
        }

        const data = await response.json();
        return data.content[0].text;
    }
} 