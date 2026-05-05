const pdf = require("pdf-poppler");
const { createWorker } = require("tesseract.js");
const fs = require("fs");

async function runOCR() {
  const pdfFile = "./documents/policy 1.pdf";
  const imagesDir = "./images";

  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir);
  }

  // حذف الصور القديمة
  fs.readdirSync(imagesDir).forEach(file => {
    if (file.endsWith(".png")) {
      fs.unlinkSync(`${imagesDir}/${file}`);
    }
  });

  console.log("⏳ تحويل PDF إلى صور عالية الجودة...");

  await pdf.convert(pdfFile, {
    format: "png",
    out_dir: imagesDir,
    out_prefix: "page",
    page: null,
    scale: 5000
  });

  console.log("⏳ تشغيل OCR عربي...");

  const worker = await createWorker("ara");

  let fullText = "";

  const files = fs.readdirSync(imagesDir)
    .filter(file => file.endsWith(".png"))
    .sort();

  for (const file of files) {
    console.log("📄 قراءة:", file);

    const result = await worker.recognize(`${imagesDir}/${file}`);
    fullText += `\n\n--- ${file} ---\n`;
    fullText += result.data.text;
  }

  fs.writeFileSync("knowledge.txt", fullText, "utf8");

  console.log("✅ تم حفظ النص في knowledge.txt");
  console.log(fullText.substring(0, 1000));

  await worker.terminate();
}

runOCR();