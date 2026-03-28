import { Router } from 'express';

const router = Router();

const getEnv = () => ({
  url: process.env.GMI_URL || 'https://api.gmi-serving.com/v1',
  key: process.env.GMI_API_KEY || '',
  model: process.env.GMI_MODEL || 'moonshotai/Kimi-K2.5',
  hydraKey: process.env.HYDRADB_API_KEY || '',
});

// In-memory conversation history per user (hackathon MVP)
const conversations = new Map();

// Tool definitions for function calling
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_history',
      description: 'Search the user\'s past trade review history in HydraDB. Use this to find patterns, past mistakes, recurring emotional triggers, or previous trades on the same symbol. Always search before giving feedback to personalize your response.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query — e.g. "BTC long trades", "FOMO patterns", "recent losses", "stop loss behavior"',
          },
        },
        required: ['query'],
      },
    },
  },
];

// Execute a tool call
async function executeTool(name, args) {
  const { hydraKey } = getEnv();

  if (name === 'search_history') {
    if (!hydraKey) return { results: [], note: 'No HydraDB configured' };

    try {
      const response = await fetch('https://api.hydradb.com/recall/full_recall', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hydraKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenant_id: 'tradebear',
          query: args.query || 'recent trade reviews',
        }),
      });

      if (!response.ok) {
        return { results: [], error: 'HydraDB recall failed' };
      }

      const data = await response.json();
      // Extract readable chunks
      const results = (data.chunks || []).map(c => c.text || c.content || JSON.stringify(c)).slice(0, 5);
      return { results, count: results.length };
    } catch (err) {
      return { results: [], error: err.message };
    }
  }

  return { error: `Unknown tool: ${name}` };
}

const SYSTEM_PROMPT = `You are TradingBear, an expert AI trading review coach.

## Tools

You have access to the search_history tool. USE IT:
- At the START of a review — search for the user's past trades on this symbol
- When the user mentions a pattern — search if they've done this before
- Before giving feedback — check if this is a recurring issue

When you call search_history, the frontend will show "🔍 Looking up past trades..." to the user.

## Flow

You guide the user through 5 dimensions IN ORDER:
1. Analysis → 2. Strategy → 3. Execution → 4. Risk Management → 5. Psychology

For EACH dimension:
1. Ask the user ONE focused question about that dimension
2. WAIT for their answer
3. You may ask 1-2 follow-up questions if needed
4. ONLY after the user has answered, output the fill_card JSON
5. Then move to the NEXT dimension

CRITICAL RULES:
- NEVER fill_card for a dimension you haven't asked about yet
- NEVER fill_card for a dimension the user hasn't answered about
- NEVER skip dimensions or fill multiple cards at once
- Only ONE fill_card per response, and only after the user answered

## Dimensions

1. **Analysis** — What did the user observe? What signals or patterns? What was their trade motivation?
2. **Strategy** — What was the plan? Entry/exit criteria? What type of trade?
3. **Execution** — Did they follow the plan? Any deviations?
4. **Risk Management** — Position size, stop loss, take profit, risk-reward?
5. **Psychology** — Emotional state? FOMO, fear, revenge trading?

## Output Format

After user answers a dimension, output on its own line:
{"action":"fill_card","dimension":"analysis","summary":"One sentence summary","score":7}

Dimension keys: "analysis", "strategy", "execution", "risk", "psychology"

After ALL 5 are done, output:
{"action":"review_complete","overall_grade":"B+","trade_summary":"BTCUSDT Long","main_issue":"Entered too early","lesson":"Don't change bias on a single candle","next_rule":"Wait for pullback confirmation","lessons":["Lesson 1"],"action_items":["Action 1"]}

## Language
- Default: respond in ENGLISH
- If the user writes in Chinese, switch to Chinese

## Rules
- Keep responses SHORT (2-3 sentences)
- Ask ONE question at a time
- Be specific, not generic
- Use search_history proactively to personalize feedback
- When you receive [CHART_CONTEXT], use it to ask a specific first question about Analysis`;

const MAX_TOOL_LOOPS = 15;

// SSE-based agent loop — streams status events to frontend in real-time
router.post('/', async (req, res) => {
  const { query, conversation_id, user_id, image } = req.body;

  if (!query || !user_id) {
    return res.status(400).json({ error: 'query and user_id are required' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendEvent(type, data) {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  }

  try {
    const { url, key, model } = getEnv();
    const convId = conversation_id || `conv_${user_id}_${Date.now()}`;

    if (!conversations.has(convId)) {
      conversations.set(convId, []);
    }
    const history = conversations.get(convId);

    // Build user message — with image if provided
    if (image) {
      history.push({
        role: 'user',
        content: [
          { type: 'text', text: query },
          { type: 'image_url', image_url: { url: image } },
        ],
      });
    } else {
      history.push({ role: 'user', content: query });
    }

    sendEvent('status', { message: 'Thinking...', conversation_id: convId });

    let loopCount = 0;

    while (loopCount < MAX_TOOL_LOOPS) {
      loopCount++;

      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
      ];

      const response = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          tools: TOOLS,
          tool_choice: 'auto',
          stream: false,
        }),
      });

      if (!response.ok) {
        console.error('GMI Cloud error:', response.status, await response.text());
        const fallbackMsg = key
          ? 'GMI Cloud API error. Check your API key.'
          : 'No GMI API key configured.';
        sendEvent('answer', { answer: fallbackMsg, conversation_id: 'error' });
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      const result = await response.json();
      const choice = result.choices?.[0];
      const message = choice?.message;

      if (!message) {
        sendEvent('answer', { answer: 'No response from AI.', conversation_id: convId });
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      // Check if AI wants to call tools
      if (message.tool_calls && message.tool_calls.length > 0) {
        history.push({
          role: 'assistant',
          content: message.content || '',
          tool_calls: message.tool_calls,
        });

        for (const toolCall of message.tool_calls) {
          const fnName = toolCall.function.name;
          let fnArgs = {};
          try {
            fnArgs = JSON.parse(toolCall.function.arguments || '{}');
          } catch (e) {}

          // Send real-time status to frontend
          console.log(`🔧 Tool call: ${fnName}(${JSON.stringify(fnArgs)})`);
          sendEvent('tool_call', { tool: fnName, args: fnArgs });

          const toolResult = await executeTool(fnName, fnArgs);

          sendEvent('tool_result', {
            tool: fnName,
            resultCount: toolResult.results?.length || 0,
          });

          history.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        sendEvent('status', { message: 'Thinking...' });
        continue;
      }

      // No tool calls — final response
      const answer = message.content || 'No response from AI.';
      history.push({ role: 'assistant', content: answer });

      sendEvent('answer', { answer, conversation_id: convId });
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    sendEvent('answer', { answer: 'I had trouble processing that. Could you try again?', conversation_id: convId });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat proxy error:', err);
    sendEvent('answer', { answer: 'Error: Connection failed' });
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

export default router;
