const fs = require("fs");
const cheerio = require("cheerio");

async function loadWebPage(url) {
  const res = await fetch(url);
  const html = await res.text();

  const $ = cheerio.load(html);
  $("script, style, nav, footer").remove();

  const text = $("body").text()
    .replace(/\s+/g, " ")
    .trim();

  return `\n\n--- Web Page: ${url} ---\n${text}`;
}

async function buildKnowledge() {
  let knowledge = "";

  // اقرأ ملف PDF 
  if (fs.existsSync("knowledge.txt")) {
    knowledge += fs.readFileSync("knowledge.txt", "utf8");
  }

  // اقرأ صفحة ويب
  const url = "https://www.unizwa.edu.om";
  const webText = await loadWebPage(url);
  knowledge += webText;

  fs.writeFileSync("rag_knowledge.txt", knowledge, "utf8");

  console.log("✅ تم إنشاء rag_knowledge.txt");
}

buildKnowledge();