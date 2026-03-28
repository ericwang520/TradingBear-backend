import { config } from 'dotenv';
config();

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3010;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

import screenshotRouter from './routes/screenshot.js';
import chatRouter from './routes/chat.js';
import hydraRouter from './routes/hydra.js';
app.use('/api/screenshot', screenshotRouter);
app.use('/api/chat', chatRouter);
app.use('/api/hydra', hydraRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mock endpoint for testing without Dify
app.post('/api/chat/mock', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const messages = [
    { event: 'message', answer: 'I see you were looking at a trading chart. ', conversation_id: 'mock_123' },
    { event: 'message', answer: 'Let me help you review this trade. ' },
    { event: 'message', answer: 'What was your entry point and reasoning? ' },
  ];

  let i = 0;
  const interval = setInterval(() => {
    if (i >= messages.length) {
      res.write('data: [DONE]\n\n');
      res.end();
      clearInterval(interval);
      return;
    }
    res.write(`data: ${JSON.stringify(messages[i])}\n\n`);
    i++;
  }, 500);
});

app.listen(PORT, () => {
  console.log(`TraderBear backend running on port ${PORT}`);
});

export default app;
