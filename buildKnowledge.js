const fs = require("fs");
const cheerio = require("cheerio");
const iconv = require("iconv-lite");

async function loadWebPage(url) {
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());

  // مهم لموقع الجامعة
  let html = iconv.decode(buffer, "windows-1256");

  const $ = cheerio.load(html);
  $("script, style, nav, footer").remove();

  const text = $("body").text()
    .replace(/\s+/g, " ")
    .trim();

  return `\n\n--- Web Page: ${url} ---\n${text}`;
}

async function buildKnowledge() {
  let knowledge = "";

  if (fs.existsSync("knowledge.txt")) {
    knowledge += fs.readFileSync("knowledge.txt", "utf8");
  }

  const webPages = [
    "https://www.unizwa.edu.om/program_details.php?college=2&comingfrom=761&lang=ar",
    "https://www.unizwa.edu.om/index.php"
  ];

  for (const url of webPages) {
    try {
      console.log("🌐 قراءة:", url);
      const webText = await loadWebPage(url);
      knowledge += webText;
    } catch (err) {
      console.log("❌ فشل قراءة:", url);
      console.log(err.message);
    }
  }

  fs.writeFileSync("rag_knowledge.txt", knowledge, "utf8");
  console.log("✅ تم إنشاء rag_knowledge.txt");
}

buildKnowledge();
