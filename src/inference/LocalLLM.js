import { Logger } from '../core/Logger.js';

/**
 * LocalLLM — Lightweight local inference for QVAC-Pear nodes.
 *
 * Priority:
 *   1. Ollama (http://localhost:11434) — if running
 *   2. Configured external API (OPENAI_API_KEY / LLM_API_URL)
 *   3. Demo mode — returns structured markdown for testing
 *
 * All generated content is stored in Hypercore for distributed access.
 */
export class LocalLLM {
  constructor(config = {}) {
    this.config = {
      ollamaUrl: config.ollamaUrl || 'http://localhost:11434',
      model: config.model || 'llama3.2:1b',
      fallbackApiKey: config.fallbackApiKey || process.env.OPENAI_API_KEY || '',
      fallbackUrl: config.fallbackUrl || process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions',
      fallbackModel: config.fallbackModel || process.env.LLM_MODEL || 'gpt-4o-mini',
      timeout: config.timeout || 120000,
      demoMode: config.demoMode || false,
      ...config
    };
    this.logger = new Logger('LocalLLM');
    this.ollamaAvailable = null; // null = not checked yet
  }

  async initialize() {
    this.logger.info('Initializing LocalLLM...');
    await this._checkOllama();
    if (this.ollamaAvailable) {
      this.logger.info(`Ollama ready at ${this.config.ollamaUrl} (model: ${this.config.model})`);
    } else if (this.config.fallbackApiKey) {
      this.logger.info('Ollama not found — using fallback API');
    } else if (this.config.demoMode) {
      this.logger.info('Demo mode enabled — no live inference');
    } else {
      this.logger.warn('No LLM backend available. Set OPENAI_API_KEY or install Ollama.');
    }
  }

  async _checkOllama() {
    try {
      const resp = await fetch(`${this.config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const data = await resp.json();
        this.ollamaAvailable = true;
        // Pick first available model if default not present
        const models = data.models || [];
        if (models.length > 0 && !models.find(m => m.name === this.config.model)) {
          this.config.model = models[0].name;
          this.logger.info(`Using available Ollama model: ${this.config.model}`);
        }
        return;
      }
    } catch (e) {
      // Ollama not reachable
    }
    this.ollamaAvailable = false;
  }

  /**
   * Generate markdown content from a prompt.
   */
  async generate(prompt, options = {}) {
    const title = options.title || prompt.split('.')[0].slice(0, 60);

    if (this.ollamaAvailable) {
      return this._generateOllama(prompt, title);
    }
    if (this.config.fallbackApiKey) {
      return this._generateFallback(prompt, title);
    }
    return this._generateDemo(prompt, title);
  }

  async _generateOllama(prompt, title) {
    this.logger.info(`Generating via Ollama: ${title}`);
    const system = (
      'You are a wiki writer. Write high-quality markdown content. ' +
      'Use headings, lists, bold/italic, code blocks, tables, and wiki links [[PageName]] where relevant. ' +
      'Use #tags for categorization. Be concise but thorough. ' +
      'Output ONLY the markdown body content — no explanations, no wrap-up sentences.'
    );

    const resp = await fetch(`${this.config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        system,
        prompt: `Write a wiki page about: ${prompt}`,
        stream: false,
        options: { temperature: 0.7 }
      }),
      signal: AbortSignal.timeout(this.config.timeout)
    });

    if (!resp.ok) {
      throw new Error(`Ollama error: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    return { title, body: data.response.trim(), source: 'ollama', model: this.config.model };
  }

  async _generateFallback(prompt, title) {
    this.logger.info(`Generating via fallback API: ${title}`);
    const messages = [
      {
        role: 'system',
        content: (
          'You are a wiki writer. Write high-quality markdown content. ' +
          'Use headings, lists, bold/italic, code blocks, tables, and wiki links [[PageName]] where relevant. ' +
          'Use #tags for categorization. Be concise but thorough. ' +
          'Output ONLY the markdown body content — no explanations, no wrap-up sentences.'
        )
      },
      { role: 'user', content: `Write a wiki page about: ${prompt}` }
    ];

    const resp = await fetch(this.config.fallbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.fallbackApiKey}`
      },
      body: JSON.stringify({
        model: this.config.fallbackModel,
        messages,
        temperature: 0.7,
        max_tokens: 4000
      }),
      signal: AbortSignal.timeout(this.config.timeout)
    });

    if (!resp.ok) {
      throw new Error(`API error: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    const body = data.choices?.[0]?.message?.content?.trim() || '';
    return { title, body, source: 'api', model: this.config.fallbackModel };
  }

  _generateDemo(prompt, title) {
    this.logger.info(`Generating demo content: ${title}`);
    const body = `# ${title}\n\n` +
      `This is a demo-generated wiki page about **${prompt}**.\n\n` +
      `## Overview\n\n` +
      `- Key point one\n` +
      `- Key point two\n` +
      `- Key point three\n\n` +
      `## Details\n\n` +
      `> A blockquote with important information.\n\n` +
      `\`\`\`javascript\n` +
      `// Example code\n` +
      `console.log("Hello from QVAC AI");\n` +
      `\`\`\`\n\n` +
      `## Related\n\n` +
      `- [[Related Page]]\n` +
      `- [[Another Topic]]\n\n` +
      `#demo #generated\n`;
    return { title, body, source: 'demo', model: 'none' };
  }

  getStatus() {
    return {
      ollamaAvailable: this.ollamaAvailable,
      model: this.config.model,
      fallbackConfigured: !!this.config.fallbackApiKey,
      demoMode: this.config.demoMode
    };
  }
}
