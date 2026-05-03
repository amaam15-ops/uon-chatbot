# UoN Smart Academic Advisor Chatbot

مشروع شاتبوت أكاديمي لجامعة نزوى مطابق لفكرة: AI + Knowledge Base + RL Feedback + Backend API.

## لماذا هذه النسخة؟
- المفتاح السري لا يظهر في المتصفح.
- `GPA` و `CGPA` و `المعدل` تذهب مباشرة لقاعدة المعرفة.
- يوجد Backend endpoint للذكاء الاصطناعي: `/api/chat`.
- يوجد Feedback endpoint: `/api/feedback` يحفظ thumbs up/down في `feedback.json`.
- يمكن ربطه بـ GitHub ثم Deploy على Render أو Vercel.

## التشغيل محلياً
```bash
npm install
cp .env.example .env
# افتحي .env وضعي ANTHROPIC_API_KEY
npm start
```

ثم افتحي:

```text
http://localhost:3000
```

## رفعه على GitHub
```bash
git init
git add .
git commit -m "Add production UoN chatbot"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

## Deploy باستخدام Render
1. ادخلي render.com
2. New + > Web Service
3. اربطي GitHub repo
4. Build Command:
```bash
npm install
```
5. Start Command:
```bash
npm start
```
6. Environment Variable:
```text
ANTHROPIC_API_KEY = your_real_key
```
7. اضغطي Deploy.

## ملاحظة مهمة
GitHub Pages لا يشغل Node.js backend. لذلك GitHub Pages يصلح للواجهة فقط، أما هذا المشروع يحتاج Render أو Vercel أو Railway لأنه يحتوي Backend آمن.
