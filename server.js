// server.js - 本地 Express 服务器（流式转发修复版）
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = 'https://api.iamhc.cn/v1/chat/completions';
const API_KEY = 'sk-7LRggVLwgm5A7aai7tJPllYtd6lXrTY4PSfqF6feGd0YCELP';

app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 聊天代理 (SSE)
app.post('/api/chat', async (req, res) => {
  const { model, messages, temperature = 0.7, max_tokens = 8192 } = req.body;

  if (!model || !messages) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `上游 API 错误: ${errText}` });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            res.write(line + '\n');
          }
        }
      }
      // 处理剩余 buffer
      if (buffer.trim()) {
        res.write(buffer + '\n');
      }
    } catch (streamErr) {
      console.error('流中断:', streamErr);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('API 请求失败:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: `请求失败: ${err.message}` });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`🚀 服务已启动: http://localhost:${PORT}`);
});