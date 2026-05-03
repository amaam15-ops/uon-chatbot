import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
const PORT = process.env.PORT || 3000;
const feedbackFile = path.resolve('feedback.json');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const KB = [
  {
    intent: 'uon_about',
    keys: ['جامعة نزوى','عن الجامعة','university of nizwa','uon','تأسست','نشأة'],
    ar: '**جامعة نزوى (UoN)**\n• تأسست عام **2004** — جامعة خاصة غير ربحية في نزوى، الداخلية.\n• توفر برامج أكاديمية متنوعة وتدعم التحول الرقمي في الخدمات الطلابية.\n• الموقع: www.unizwa.edu.om',
    en: '**University of Nizwa (UoN)**\n• Founded in **2004** — a private non-profit university in Nizwa, Oman.\n• Offers diverse academic programs and supports digital student services.\n• Website: www.unizwa.edu.om'
  },
  {
    intent: 'programs',
    keys: ['الكليات','البرامج','التخصصات','colleges','programs','cas','cemis','cea','cpn','كلية العلوم','كلية الهندسة','كلية الصيدلة','كلية الاقتصاد'],
    ar: '**الكليات الأربع في جامعة نزوى:**\n🔬 **CAS** — كلية العلوم والآداب\n💼 **CEMIS** — كلية الاقتصاد والإدارة ونظم المعلومات\n⚙️ **CEA** — كلية الهندسة والعمارة\n💊 **CPN** — كلية الصيدلة والتمريض\n\nاسألني عن كلية معيّنة وسأعطيك تفاصيل أكثر.',
    en: '**The four UoN colleges:**\n🔬 **CAS** — College of Arts and Sciences\n💼 **CEMIS** — College of Economics, Management and Information Systems\n⚙️ **CEA** — College of Engineering and Architecture\n💊 **CPN** — College of Pharmacy and Nursing'
  },
  {
    intent: 'gpa',
    keys: ['gpa','cgpa','المعدل','المعدل التراكمي','نظام الدرجات','احتساب المعدل','حساب المعدل','academic status','grades','grading'],
    ar: '**المعدل التراكمي CGPA / GPA**\n\nطريقة الحساب:\n**المعدل = مجموع (نقاط المادة × عدد الساعات) ÷ مجموع الساعات**\n\nنظام الدرجات:\nA=4.0 | A-=3.7 | B+=3.3 | B=3.0 | B-=2.7\nC+=2.3 | C=2.0 | D+=1.3 | D=1.0 | F=0.0\n\n⚠️ الحد الأدنى الآمن غالبًا هو **2.0**. إذا أعطيتني درجاتك وعدد الساعات، أحسبه لك.',
    en: '**CGPA / GPA**\n\nFormula:\n**GPA = Sum(grade points × credit hours) ÷ total credit hours**\n\nGrade points:\nA=4.0 | A-=3.7 | B+=3.3 | B=3.0 | B-=2.7\nC+=2.3 | C=2.0 | D+=1.3 | D=1.0 | F=0.0\n\n⚠️ The safe minimum is usually **2.0**. Send your courses, grades, and credit hours and I can calculate it.'
  },
  {
    intent: 'probation',
    keys: ['الإنذار الأكاديمي','إنذار أكاديمي','academic probation','academic warning','warning','سحب قسري','منحة','scholarship'],
    ar: '**نظام الإنذار الأكاديمي:**\n⚠️ الإنذار الأول: عند انخفاض المعدل عن المستوى المطلوب.\n🔴 الإنذار الثاني: يزيد الخطر على الاستمرار الأكاديمي والمنحة.\n❌ تكرار الإنذارات قد يؤدي إلى سحب قسري أو التأثير على المنحة.\n\nإذا حالتك فيها إنذار حقيقي، الأفضل التواصل مع المرشد الأكاديمي أيضًا.',
    en: '**Academic warning / probation:**\n⚠️ First warning: CGPA below the required level.\n🔴 Second warning: higher risk for progression and scholarship.\n❌ Repeated warnings may affect scholarship or lead to compulsory withdrawal.'
  },
  {
    intent: 'registration',
    keys: ['قواعد التسجيل','التسجيل الدراسي','عدد الساعات','الساعات المسموح','الحد الأدنى للساعات','الحد الأقصى للساعات','course registration','registration'],
    ar: '**قواعد التسجيل العامة:**\n📚 الحد الأدنى غالبًا: **12 ساعة**\n📚 الحد الأقصى غالبًا: **18 ساعة**\n• المتطلبات السابقة مهمة قبل تسجيل المقرر.\n• الانسحاب والإضافة لها مواعيد محددة.',
    en: '**General registration rules:**\n📚 Minimum is usually **12 credits**\n📚 Maximum is usually **18 credits**\n• Prerequisites must be met.\n• Add/drop and withdrawal have official deadlines.'
  },
  {
    intent: 'graduation',
    keys: ['شروط التخرج','متطلبات التخرج','graduation requirements','ساعات التخرج','graduate'],
    ar: '**شروط التخرج العامة:**\n🎓 إكمال الساعات المطلوبة حسب الخطة.\n• تحقيق معدل تراكمي لا يقل عن **2.0**.\n• استيفاء متطلبات البرنامج والجامعة.\n• تقديم طلب التخرج حسب إجراءات عمادة التسجيل.',
    en: '**General graduation requirements:**\n🎓 Complete the required credit hours.\n• Minimum CGPA of **2.0**.\n• Complete program and university requirements.\n• Apply through the registration office.'
  },
  {
    intent: 'guidance_contact',
    keys: ['مركز الإرشاد','مركز الإرشاد الأكاديمي','academic guidance','advising centre','المرشد الأكاديمي','تواصل','رقم','contact'],
    ar: '**مركز الإرشاد والمتابعة الأكاديمية:**\n📞 **+968 25 446234**\n🌐 **www.unizwa.edu.om**\n\nيفيدك خصوصًا في الحالات الخاصة أو الإنذار الأكاديمي أو مشاكل التسجيل.',
    en: '**Academic Guidance Centre:**\n📞 **+968 25 446234**\n🌐 **www.unizwa.edu.om**\n\nUseful for sensitive cases, academic warnings, and registration issues.'
  }
];

function detectLang(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return arabicChars > text.length * 0.25 ? 'ar' : 'en';
}

function normalize(text) {
  return text.toLowerCase().replace(/[؟?.,!،؛:]/g, ' ').replace(/\s+/g, ' ').trim();
}

function kbFind(question) {
  const q = normalize(question);
  let best = null;
  let bestScore = 0;

  for (const item of KB) {
    let score = 0;
    for (const key of item.keys) {
      const k = normalize(key);
      if (q === k) score += 100;
      else if (q.includes(k)) score += Math.max(10, k.length);
      else if (k.includes(q) && q.length >= 3) score += 8;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 8 ? best : null;
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
    const kb = kbFind(message);
    const escalate = needsHuman(message);

    if (kb && !escalate) {
      return res.json({
        mode: 'kb',
        intent: kb.intent,
        answer: kb[lang] || kb.en,
        escalate: false
      });
    }

    if (!anthropic) {
      const fallback = kb
        ? kb[lang] || kb.en
        : lang === 'ar'
          ? 'ما حصلت إجابة دقيقة من قاعدة المعرفة. جرّب تسأل عن المعدل، التسجيل، الإنذار الأكاديمي، التخرج، أو الكليات.'
          : 'I could not find a precise answer in the knowledge base. Try asking about GPA, registration, academic warnings, graduation, or colleges.';
      return res.json({ mode: 'fallback', answer: fallback, escalate });
    }

    const system = lang === 'ar'
      ? 'أنت المستشار الأكاديمي الذكي لجامعة نزوى. أجب بالعربية بأسلوب واضح ودافئ. اعتمد على المعلومات المؤسسية المعروفة، ولا تخترع أرقامًا أو سياسات غير مؤكدة. إذا كانت الحالة شخصية أو حساسة، وجّه الطالب لمركز الإرشاد.'
      : 'You are the AI Academic Advisor for the University of Nizwa. Be clear, concise, and avoid inventing institutional policies. Escalate personal or sensitive cases to the Academic Guidance Centre.';

    const completion = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 500,
      system,
      messages: [
        ...history.filter(m => ['user', 'assistant'].includes(m.role)).map(m => ({ role: m.role, content: String(m.content).slice(0, 1000) })),
        { role: 'user', content: message }
      ]
    });

    const answer = completion.content?.[0]?.text || (lang === 'ar' ? 'تعذر توليد إجابة الآن.' : 'Could not generate an answer now.');
    res.json({ mode: 'ai', answer, escalate });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Server error' });
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
  res.json({ ok: true, ai: Boolean(anthropic) });
});

app.listen(PORT, () => {
  console.log(`UoN chatbot running on http://localhost:${PORT}`);
});
