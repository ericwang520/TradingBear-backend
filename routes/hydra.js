import { Router } from 'express';

const router = Router();

const HYDRA_URL = 'https://api.hydradb.com';

const getKey = () => process.env.HYDRADB_API_KEY || '';

// Recall past reviews for a user
router.post('/recall', async (req, res) => {
  const { user_id, query } = req.body;
  const key = getKey();

  if (!key) {
    return res.json({ results: [], note: 'No HydraDB key configured' });
  }

  try {
    const response = await fetch(`${HYDRA_URL}/recall/full_recall`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: 'tradebear',
        query: query || 'recent trade reviews, patterns, emotional triggers',
      }),
    });

    if (!response.ok) {
      console.error('HydraDB recall error:', response.status);
      return res.json({ results: [], error: 'HydraDB recall failed' });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('HydraDB recall error:', err);
    res.json({ results: [], error: err.message });
  }
});

// Save a review to HydraDB
router.post('/save', async (req, res) => {
  const { user_id, review } = req.body;
  const key = getKey();

  if (!key) {
    return res.status(400).json({ error: 'No HydraDB key configured' });
  }

  if (!user_id || !review) {
    return res.status(400).json({ error: 'user_id and review are required' });
  }

  try {
    // Build the content string from the review
    const content = [
      `Trade Review: ${review.trade_summary || 'Unknown trade'}`,
      `Grade: ${review.grade || 'N/A'}`,
      `Analysis: ${review.analysis || ''}`,
      `Strategy: ${review.strategy || ''}`,
      `Execution: ${review.execution || ''}`,
      `Risk Management: ${review.risk || ''}`,
      `Psychology: ${review.psychology || ''}`,
      `Main Issue: ${review.main_issue || ''}`,
      `Lesson: ${review.lesson || ''}`,
      `Next Rule: ${review.next_rule || ''}`,
    ].filter(line => !line.endsWith(': ')).join('\n');

    const response = await fetch(`${HYDRA_URL}/memories/add_memory`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: 'tradebear',
        memories: [{ text: content }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('HydraDB save error:', response.status, errText);
      return res.status(response.status).json({ error: 'Failed to save to HydraDB' });
    }

    const data = await response.json();
    res.json({ success: true, data });
  } catch (err) {
    console.error('HydraDB save error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
