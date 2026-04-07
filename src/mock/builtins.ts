/**
 * PayGate — Built-in mock API handlers for the demo merchant.
 */

const jokes = [
  { setup: 'Why do programmers prefer dark mode?', punchline: 'Because light attracts bugs.' },
  { setup: "What's a programmer's favorite hangout?", punchline: 'Foo Bar.' },
  { setup: 'Why do Java developers wear glasses?', punchline: "Because they can't C#." },
  { setup: 'How many programmers does it take to change a light bulb?', punchline: "None. That's a hardware problem." },
  { setup: 'Why did the developer go broke?', punchline: 'Because he used up all his cache.' },
  { setup: "What's the object-oriented way to become wealthy?", punchline: 'Inheritance.' },
  { setup: 'Why do Python programmers have low self-esteem?', punchline: "They're constantly comparing themselves to others." },
  { setup: 'What did the router say to the doctor?', punchline: 'It hurts when IP.' },
];

const quotes = [
  { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
  { text: 'Programs must be written for people to read.', author: 'Harold Abelson' },
  { text: 'Any fool can write code that a computer can understand.', author: 'Martin Fowler' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: 'The most dangerous phrase is "We\'ve always done it this way."', author: 'Grace Hopper' },
];

const weatherData: Record<string, { temp: number; condition: string; humidity: number; wind: number }> = {
  london: { temp: 14, condition: 'Cloudy', humidity: 78, wind: 12 },
  tokyo: { temp: 22, condition: 'Sunny', humidity: 55, wind: 8 },
  'new york': { temp: 18, condition: 'Partly cloudy', humidity: 62, wind: 15 },
  sydney: { temp: 25, condition: 'Clear', humidity: 45, wind: 10 },
  paris: { temp: 16, condition: 'Rainy', humidity: 85, wind: 20 },
  dubai: { temp: 38, condition: 'Sunny', humidity: 30, wind: 5 },
  berlin: { temp: 12, condition: 'Overcast', humidity: 72, wind: 18 },
  singapore: { temp: 31, condition: 'Thunderstorm', humidity: 90, wind: 6 },
};

export function handleBuiltin(handler: string, query: Record<string, string>, body: any): any {
  switch (handler) {
    case '__builtin:joke':
      return jokes[Math.floor(Math.random() * jokes.length)];
    case '__builtin:quote':
      return quotes[Math.floor(Math.random() * quotes.length)];
    case '__builtin:weather': {
      const city = (query.city || 'london').toLowerCase().trim();
      const data = weatherData[city];
      if (!data) return { error: `City "${city}" not found. Try: ${Object.keys(weatherData).join(', ')}` };
      return { city, ...data, unit: 'celsius' };
    }
    case '__builtin:translate': {
      const { text, to } = body || {};
      if (!text || !to) return { error: 'Missing text or to' };
      const translations: Record<string, (t: string) => string> = {
        es: (t) => `[ES] ${t} (traducido)`, fr: (t) => `[FR] ${t} (traduit)`,
        de: (t) => `[DE] ${t} (ubersetzt)`, ja: (t) => `[JA] ${t} (翻訳済み)`,
        zh: (t) => `[ZH] ${t} (已翻译)`,
      };
      const fn = translations[to.toLowerCase()];
      if (!fn) return { error: `Language "${to}" not supported. Try: ${Object.keys(translations).join(', ')}` };
      return { original: text, translated: fn(text), language: to };
    }
    case '__builtin:summarize': {
      const text = body?.text || '';
      const sentences = text.split(/[.!?]+/).filter(Boolean);
      const wordCount = text.split(/\s+/).length;
      return {
        summary: (sentences[0]?.trim() || text) + '.',
        originalLength: wordCount,
        compressionRatio: Math.round((1 - (sentences[0]?.trim().split(/\s+/).length || 0) / wordCount) * 100) + '%',
      };
    }
    default:
      return { error: 'Unknown builtin handler' };
  }
}
