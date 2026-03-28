import { Router } from 'express';

const router = Router();

const getEnv = () => ({
  url: process.env.GMI_URL || 'https://api.gmi-serving.com/v1',
  key: process.env.GMI_API_KEY || '',
  model: process.env.GMI_MODEL || 'moonshotai/Kimi-K2.5',
});

router.post('/', async (req, res) => {
  const { screenshot, user_id } = req.body;

  if (!screenshot || !user_id) {
    return res.status(400).json({ error: 'screenshot and user_id are required' });
  }

  try {
    const { url, key, model } = getEnv();

    const response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this trading chart screenshot. Extract: 1) Trading pair/symbol 2) Timeframe 3) Key patterns or signals visible 4) Key price levels (support/resistance). Return a JSON object with fields: symbol, timeframe, patterns (array), key_levels (array of numbers), summary (one sentence description). Return ONLY the JSON, no other text.',
              },
              {
                type: 'image_url',
                image_url: { url: screenshot },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';

    // Try to parse JSON from the response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        return res.json({ data: { outputs: analysis } });
      }
    } catch (e) {
      // If JSON parsing fails, return raw summary
    }

    res.json({
      data: {
        outputs: {
          summary: content,
          symbol: '',
          timeframe: '',
          patterns: [],
          key_levels: [],
        },
      },
    });
  } catch (err) {
    console.error('Screenshot analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze screenshot' });
  }
});

export default router;
