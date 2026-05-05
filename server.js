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

async function loadKnowledge() {
try {
return await fs.readFile(knowledgeFile, 'utf8');
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
.replace(/[؟?.,!،؛:()[]{}"'“”]/g, ' ')
.replace(/\s+/g, ' ')
.trim();
}

// 🔥 RL: تعلم من الفيدباك
async function getKeywordBoost() {
try {
const feedback = await readFeedback();
const boost = {};

```
feedback
  .filter(f => f.rating === 1)
  .forEach(f => {
    const words = normalize(f.message || '').split(' ');
    words.forEach(w => {
      if (w.length > 2) {
        boost[w] = (boost[w] || 0) + 2;
      }
    });
  });

return boost;
```

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

// 🔥 RAG + RL
async function getRelevantContext(question, text) {
const chunks = text
.split(/---|\n\s*\n/)
.map(c => c.trim())
.filter(c => c.length > 40);

const qWords = expandQuery(question);
const normalizedQuestion = normalize(question);

const boost = await getKeywordBoost();

const scored = chunks.map(chunk => {
const cleanChunk = normalize(chunk);
let score = 0;

```
for (const word of qWords) {
  if (cleanChunk.includes(word)) {
    score += 2;

    if (boost[word]) {
      score += boost[word]; // 🔥 RL
    }
  }
}

if (cleanChunk.includes('كليه') && normalizedQuestion.includes('كليه')) score += 8;
if (cleanChunk.includes('برنامج') && normalizedQuestion.includes('برنامج')) score += 8;

return { chunk, score };
```

});

const relevant = scored
.filter(x => x.score > 0)
.sort((a, b) => b.score - a.score)
.slice(0, 12)
.map(x => x.chunk)
.join('\n\n');

return relevant || text.slice(0, 8000);
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
}

app.post('/api/chat', async (req, res) => {
try {
const message = String(req.body.message || '').trim();
const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];

```
if (!message) {
  return res.status(400).json({ error: 'Message is required' });
}

const lang = detectLang(message);
const escalate = needsHuman(message);

const allKnowledge = await loadKnowledge();
const knowledge = await getRelevantContext(message, allKnowledge);

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
```

أنت مستشار أكاديمي ذكي لجامعة نزوى.

أجب بنفس لغة سؤال الطالب فقط:

* إذا كان السؤال بالعربية → أجب بالعربية فقط.
* إذا كان السؤال بالإنجليزية → أجب بالإنجليزية فقط.
* لا تخلط بين اللغتين نهائيًا.

أجب بشكل مباشر ومختصر.
استخدم نقاط واضحة ومنظمة.

اعتمد على المعلومات التالية :
${knowledge}

مهم:

* لا تترجم المصطلحات حرفيًا.
* لا تكتب كلمات غريبة أو غير مفهومة.
* لا تذكر معلومات غير موجودة في النص.
  -اسلوب الرد جاذب

إذا لم تجد الإجابة:
قل: "لا تتوفر لدي معلومات دقيقة حول ذلك حاليًا." واقترح له التواصل مع الجامعه او الدخول للموقع
`;

```
const safeHistory = history
  .filter(m => ['user', 'assistant'].includes(m.role))
  .map(m => ({
    role: m.role,
    content: String(m.content || '').slice(0, 1000)
  }));

const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${openrouterKey}`,
    'HTTP-Referer': 'https://uon-chatbot.onrender.com',
    'X-Title': 'UoN Smart Academic Advisor'
  },
  body: JSON.stringify({
    model: 'openrouter/free',
    messages: [
      { role: 'system', content: system },
      ...safeHistory,
      { role: 'user', content: message }
    ]
  })
});

const data = await response.json();

if (!response.ok) {
  return res.status(response.status).json({
    error: data?.error?.message || JSON.stringify(data)
  });
}

let answer = data?.choices?.[0]?.message?.content || 'تعذر توليد إجابة الآن.';

// 🔥 RL إعادة محاولة
const feedback = await readFeedback();

const negativeCount = feedback.filter(f =>
  f.rating === -1 &&
  normalize(f.message).includes(normalize(message))
).length;

if (negativeCount >= 2) {
  const retryResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openrouterKey}`
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [
        {
          role: 'system',
          content: system + "\nحاول الإجابة بطريقة أوضح وبأسلوب مختلف."
        },
        { role: 'user', content: message }
      ]
    })
  });

  const retryData = await retryResponse.json();
  answer = retryData?.choices?.[0]?.message?.content || answer;
}

return res.json({
  mode: 'rag_rl',
  answer,
  escalate
});
```

} catch (error) {
return res.status(500).json({ error: error.message || 'Server error' });
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
