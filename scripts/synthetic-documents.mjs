import JSZip from "jszip";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export async function documentFixtures(folder) {
  const stream = "BT /F1 12 Tf 20 60 Td (AB) Tj ET",
    cmap =
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <41> <4E2D> <42> <6587> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    ...[3, 4].map(
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 7 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ];
  let body = "%PDF-1.7\n",
    offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = Buffer.byteLength(body);
  body +=
    `xref\n0 8\n0000000000 65535 f \n` +
    offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Root 1 0 R /Size 8 >>\nstartxref\n${start}\n%%EOF`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文文档验收，不代表用户观点。</w:t></w:r></w:p></w:body></w:document>',
  );
  const files = [
    join(folder, "中文多页.pdf"),
    join(folder, "中文文档.docx"),
    join(folder, "文本.txt"),
  ];
  writeFileSync(files[0], body);
  writeFileSync(files[1], await zip.generateAsync({ type: "nodebuffer" }));
  writeFileSync(files[2], "文本资料第一段\n\n第二段");
  return files;
}
