import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const feedbackFile = path.resolve('feedback.json');
const knowledgeFile = path.resolve('rag_knowledge.txt');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const openrouterKey = process.env.OPENROUTER_API_KEY || null;

// ✅ Cache المعرفة
let cachedKnowledge = '';

// ✅ Cache الـ Boost مع انتهاء صلاحية 5 دقايق
let cachedBoost = null;
let lastBoostUpdate = 0;

async function loadKnowledge() {
  try {
    if (!cachedKnowledge) {
      cachedKnowledge = await fs.readFile(knowledgeFile, 'utf8');
    }
    return cachedKnowledge;
  } catch {
    return '';
  }
}

function detectLang(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arabicChars > text.length * 0.25 ? 'ar' : 'en';
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/[؟?.,!،؛:()\[\]{}"'""]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 🔥 RL مع Cache - لا يقرأ الملف إلا كل 5 دقايق
async function getKeywordBoost() {
  const now = Date.now();
  if (cachedBoost && (now - lastBoostUpdate) < 5 * 60 * 1000) {
    return cachedBoost;
  }

  try {
    const feedback = await readFeedback();
    const boost = {};
    feedback
      .filter(f => f.rating === 1)
      .forEach(f => {
        normalize(f.message || '').split(' ').forEach(w => {
          if (w.length > 2) boost[w] = (boost[w] || 0) + 2;
        });
      });
    cachedBoost = boost;
    lastBoostUpdate = now;
    return boost;
  } catch {
    return {};
  }
}

function expandQuery(question) {
  const q = normalize(question);
  const terms = new Set(q.split(' ').filter(w => w.length > 2));

  const groups = [
    ['college', 'colleges', 'كليه', 'كليات'],
    ['program', 'programs', 'برنامج', 'برامج', 'تخصص', 'تخصصات'],
    ['fee', 'fees', 'price', 'cost', 'tuition', 'رسوم', 'تكلفه', 'سعر', 'اسعار'],
    ['credit', 'credits', 'hour', 'hours', 'ساعه', 'ساعات', 'معتمده'],
    ['calendar', 'event', 'events', 'activity', 'activities', 'تقويم', 'فعاليه', 'فعاليات', 'انشطه'],
    ['probation', 'warning', 'ملاحظه', 'انذار'],
    ['attendance', 'absence', 'حضور', 'غياب'],
    ['advisor', 'advising', 'guidance', 'ارشاد', 'مرشد']
  ];

  for (const group of groups) {
    if (group.some(t => q.includes(t))) {
      group.forEach(t => terms.add(normalize(t)));
    }
  }

  return Array.from(terms);
}

// ✅ أصبحت sync - تستقبل boost من الخارج بدل ما تناديه بنفسها
function getRelevantContext(question, text, boost = {}) {
  const chunks = text
    .split(/---|\n\s*\n/)
    .map(c => c.trim())
    .filter(c => c.length > 40);

  const qWords = expandQuery(question);
  const normalizedQuestion = normalize(question);

  const scored = chunks.map(chunk => {
    const cleanChunk = normalize(chunk);
    let score = 0;

    for (const word of qWords) {
      if (cleanChunk.includes(word)) {
        score += 2;
        if (boost[word]) score += boost[word];
      }
    }

    if (cleanChunk.includes('كليه') && (normalizedQuestion.includes('college') || normalizedQuestion.includes('كليه') || normalizedQuestion.includes('كليات'))) score += 8;
    if (cleanChunk.includes('برنامج') && (normalizedQuestion.includes('program') || normalizedQuestion.includes('تخصص') || normalizedQuestion.includes('برامج'))) score += 8;

    return { chunk, score };
  });

  const relevant = scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.chunk)
    .join('\n\n');

  const cleanRelevant = relevant
    .split('\n')
    .filter(line => !/[\\$]/.test(line))
    .filter(line => !line.includes('text{'))
    .filter(line => !line.includes('big'))
    .filter(line => !line.includes('frac'))
    .filter(line => !line.includes('sum'))
    .join('\n');

  return cleanRelevant || '';
}

function needsHuman(question) {
  const q = normalize(question);
  return ['شخصي','personal','appeal','استئناف','مرض','ظروف','شكوى','خايف','قلق','اكتئاب','طرد','فصل'].some(k => q.includes(k));
}

async function readFeedback() {
  try {
    const data = await fs.readFile(feedbackFile, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeFeedback(entry) {
  const feedback = await readFeedback();
  feedback.push({ ...entry, createdAt: new Date().toISOString() });
  await fs.writeFile(feedbackFile, JSON.stringify(feedback, null, 2));
  // ✅ أعد تعيين الـ cache بعد كل feedback جديد
  cachedBoost = null;
}

// ✅ Streaming endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const lang = detectLang(message);
    const escalate = needsHuman(message);

    // ✅ جلب المعرفة والـ boost بالتوازي
    const [allKnowledge, boost] = await Promise.all([
      loadKnowledge(),
      getKeywordBoost()
    ]);

    // ✅ sync الآن - أسرع
    const knowledge = getRelevantContext(message, allKnowledge, boost);

    if (!openrouterKey) {
      return res.json({
        mode: 'fallback',
        answer: lang === 'ar'
          ? 'لا تتوفر لدي معلومات دقيقة حول ذلك حاليًا.'
          : 'I do not have accurate information about that at the moment.',
        escalate
      });
    }

    const system = `
أنت مستشار أكاديمي ذكي لجامعة نزوى.

أجب بنفس لغة سؤال الطالب فقط وبشكل صارم:
- إذا كان السؤال بالعربية → أجب بالعربية فقط.
- إذا كان السؤال بالإنجليزية → أجب بالإنجليزية فقط.
- ممنوع خلط اللغتين نهائيًا.

أجب بشكل مباشر ومختصر.
استخدم نقاط واضحة ومنظمة.

اعتمد فقط على المعلومات التالية:
${knowledge}

مهم جدًا:
- لا تترجم المصطلحات حرفيًا.
- لا تكتب كلمات غريبة أو غير مفهومة.
- لا تذكر معلومات غير موجودة في النص.
- لا تخمن أو تضيف معلومات من عندك.
- إذا لم تجد الإجابة في النص → قل بوضوح أنك لا تملك معلومات كافية.

إذا لم تجد الإجابة:
قل: "لا تتوفر لدي معلومات دقيقة حول ذلك حاليًا." واقترح التواصل مع الجامعة أو زيارة الموقع الرسمي.
أسلوب الرد:
- ممنوع استخدام ### أو ## أو --- أو أي Markdown نهائيًا.
- استخدم الرموز التعبيرية للعناوين مثل: 🏛️ كلية العلوم
- افصل كل نقطة بسطر جديد.
- استخدم • أو - للقوائم.
- لا تكتب كل شيء في سطر واحد.
- واضح ومنظم و جاذب
`;


    const safeHistory = history
      .filter(m => ['user', 'assistant'].includes(m.role))
      .map(m => ({
        role: m.role,
        content: String(m.content || '').slice(0, 1000)
      }));

    // ✅ Streaming - المستخدم يشوف الجواب فوراً
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // أرسل metadata أول شيء
    res.write(`data: ${JSON.stringify({ type: 'meta', escalate, mode: 'rag_rl' })}\n\n`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://uon-chatbot.onrender.com',
        'X-Title': 'UoN Smart Academic Advisor'
      },
 body: JSON.stringify({
model: '@preset/uo-n',
   stream: true,
    messages: [
    { role: 'system', content: system },
    ...safeHistory,
    { role: 'user', content: message }
  ]
})
    });

if (!response.ok) {
  let errorMessage = 'الخدمة مشغولة حاليًا، حاول مرة أخرى 🙏';

  try {
    const errText = await response.text();
    const err = JSON.parse(errText);
    errorMessage = err?.error?.message || errorMessage;
  } catch {}

  res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
  return res.end();
}

    // ✅ مرر الـ stream مباشرة للعميل
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.replace('data: ', '');
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          break;
        }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices?.[0]?.delta?.content || '';
          if (text) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
          }
        } catch {
          // تجاهل chunks غير صالحة
        }
      }
    }

    res.end();

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Server error' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const { message, answer, rating, intent, mode } = req.body;
    await writeFeedback({
      message: String(message || '').slice(0, 1000),
      answer: String(answer || '').slice(0, 2000),
      rating: rating === 1 ? 1 : -1,
      intent: String(intent || ''),
      mode: String(mode || '')
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Feedback error' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ai: Boolean(openrouterKey), provider: 'openrouter' });
});

app.listen(PORT, () => {
  console.log(`UoN chatbot running on http://localhost:${PORT}`);
});
