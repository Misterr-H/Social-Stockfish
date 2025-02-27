export class GPT4Service {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    async generateResponse(prompt, maxTokens = 1000) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: maxTokens
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`GPT-4 API request failed: ${error.error?.message || response.status}`);
        }

        const data = await response.json();
        let content = data.choices[0].message.content;

        // Remove markdown code block if present
        if (content.includes('```')) {
            // Extract content between the code block markers
            const match = content.match(/```(?:json)?\n([\s\S]*?)\n```/);
            if (match) {
                content = match[1];
            } else {
                // If no match, just remove the markers
                content = content.replace(/```json\n?|```\n?/g, '');
            }
        }
        
        return content.trim();
    }
} 