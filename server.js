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
  return text.toLowerCase().replace(/[؟?.,!،؛:]/g, ' ').replace(/\s+/g, ' ').trim();
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

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const lang = detectLang(message);
    const escalate = needsHuman(message);
    const knowledge = await loadKnowledge();

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

تحدث دائمًا باللغة العربية الفصحى المبسطة، وبأسلوب طبيعي وواضح يشبه أسلوب البشر.

أجب بشكل مباشر ومختصر بدون مقدمات طويلة.
إذا كان السؤال بسيطًا، قدم إجابة قصيرة وواضحة.

عند عرض المعلومات:
- استخدم نقاط بسيطة ومنظمة
- تجنب الرموز الغريبة أو التنسيق المبالغ فيه
- لا تخلط العربية مع الإنجليزية إلا عند الضرورة

اعتمد فقط على المعلومات الرسمية التالية من لوائح الجامعة.
لا تستخدم معرفتك العامة للإجابة عن السياسات الجامعية.
لا تخترع أرقامًا أو شروطًا أو لوائح غير موجودة في النص.

إذا كانت الإجابة موجودة في اللوائح، أجب منها مباشرة.
إذا لم تكن الإجابة موجودة في اللوائح، قل:
"لا تتوفر لدي معلومات دقيقة حول ذلك حاليًا."

إذا كانت حالة الطالب شخصية أو حساسة، انصحه بمراجعة المرشد الأكاديمي أو مركز الإرشاد الأكاديمي.

المعلومات الرسمية:
${knowledge}
`;

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

    const answer = data?.choices?.[0]?.message?.content
      || 'تعذر توليد إجابة الآن.';

    return res.json({
      mode: 'ai_with_pdf',
      intent: 'policy_knowledge',
      answer,
      escalate
    });

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
