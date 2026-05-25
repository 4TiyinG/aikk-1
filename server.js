// server.js - 完整的 DeepSeek 风格流式聊天代理
require('dotenv').config();             // 从 .env 文件加载环境变量
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- 配置 ----------
const API_URL = process.env.API_URL || 'https://api.iamhc.cn/v1/chat/completions';
const API_KEY = process.env.API_KEY;   // 请在 .env 中设置 API_KEY=sk-xxxx

if (!API_KEY) {
  console.error('错误：请在 .env 文件中设置 API_KEY');
  process.exit(1);
}

// ---------- 中间件 ----------
app.use(cors());                        // 允许跨域（前后端分离时必需）
app.use(express.static(__dirname));     // 托管前端静态文件
app.use(express.json({ limit: '2mb' }));

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ---------- 核心：流式聊天代理 ----------
app.post('/api/chat', async (req, res) => {
  const { model, messages, temperature = 0.7, max_tokens = 8192 } = req.body;

  if (!model || !messages) {
    return res.status(400).json({ error: '缺少必要参数 model 或 messages' });
  }

  let upstreamResponse;
  try {
    // 请求上游 API（流式）
    upstreamResponse = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature,
        max_tokens
      })
    });
  } catch (fetchErr) {
    console.error('无法连接上游 API:', fetchErr.message);
    return res.status(502).json({ error: '无法连接上游服务' });
  }

  // 处理上游非 200 响应
  if (!upstreamResponse.ok) {
    const errText = await upstreamResponse.text();
    console.error(`上游 API 错误 ${upstreamResponse.status}:`, errText);
    // 区分认证错误（401）和限流（429）等，但这里统一返回 502
    return res.status(502).json({ error: `上游服务返回错误: ${upstreamResponse.status}` });
  }

  // ---------- 设置 SSE 响应头，并彻底禁用缓冲 ----------
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',          // 禁用 nginx 缓冲
    'Transfer-Encoding': 'chunked'      // 明确分块传输
  });

  // 立即发送响应头（重要！）
  res.flushHeaders();

  // 禁用 Node.js 底层 TCP Nagle 算法，强制小包立即发送
  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setKeepAlive(true);
  }

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // 当客户端断开连接时，主动取消上游读取
  req.on('close', () => {
    console.log('客户端断开，取消上游流');
    reader.cancel().catch(() => {});
  });

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // 发送缓冲区中可能残留的数据
        if (buffer.trim()) {
          res.write(buffer.trim() + '\n');
        }
        // 发送结束标记
        res.write('data: [DONE]\n\n');
        res.end();
        console.log('流式传输完成');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 保留最后一个可能不完整的行
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          // 直接透传给前端，并添加换行符
          res.write(trimmed + '\n');
        }
      }

      // 每一帧强制刷新（关键！）
      if (typeof res.flush === 'function') {
        res.flush();
      }
    }
  } catch (streamErr) {
    console.error('流式传输错误:', streamErr);
    // 如果响应头已发送，只能通过 SSE 格式返回错误
    if (res.writable) {
      res.write(`data: ${JSON.stringify({ error: streamErr.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

// ---------- 启动 ----------
app.listen(PORT, () => {
  console.log(`🚀 服务已启动: http://localhost:${PORT}`);
  console.log(`📡 代理目标: ${API_URL}`);
});
