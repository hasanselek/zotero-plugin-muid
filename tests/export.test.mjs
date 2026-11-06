import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { load } from "./harness.mjs";

const { Hafif, ctx } = load("notedoc", "citekey", "export");
const win = new JSDOM("").window;
ctx.Zotero.getMainWindow = () => win;
ctx.Zotero.CreatorTypes = { getPrimaryIDForType: () => 1 };
ctx.Zotero.Date = { strToDate: (s) => ({ year: (String(s).match(/\d{4}/) || [])[0] }) };
ctx.Zotero.ItemFields = { getID: () => null };
const E = Hafif.modules.export;

const item = { id: 1, getField: (f) => ({ title: "Fıkıh Usûlü", date: "2010" })[f] || "", getCreators: () => [{ creatorTypeID: 1, lastName: "Yılmaz" }], itemTypeID: 1 };
const doc = {
	title: "Deneme",
	blocks: [
		{ type: "heading", level: 1, runs: [{ text: "Deneme" }] },
		{ type: "para", runs: [{ text: "Bir iddia " }, { cite: [{ item, locator: "12", label: "page" }] }, { text: "." }] },
		{ type: "quote", runs: [{ text: "قال الإمام" }] },
		{ type: "list", ordered: false, items: [{ runs: [{ text: "a & b <c>", b: true }], depth: 0 }] },
	],
};
const fmt = { note: true, strings: ["Ahmet Yılmaz, <i>Fıkıh Usûlü</i> (İstanbul: İSAM, 2010), 12."], bibliography: ["Yılmaz, Ahmet. <i>Fıkıh Usûlü</i>. İstanbul: İSAM, 2010."], styleTitle: "İSNAD" };

test("docx parçaları iyi biçimli XML", () => {
	let parts = E.buildDocx(doc, fmt);
	for (let name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/footnotes.xml", "word/styles.xml", "word/settings.xml", "word/_rels/document.xml.rels", "docProps/core.xml"]) {
		assert.ok(parts[name], name);
		let x = new win.DOMParser().parseFromString(parts[name], "application/xml");
		assert.equal(x.getElementsByTagName("parsererror").length, 0, name);
	}
	assert.match(parts["word/document.xml"], /<w:footnoteReference w:id="1"\/>/);
	assert.match(parts["word/document.xml"], /iddia<\/w:t><\/w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/, "dipnottan önceki boşluk atılır");
	assert.match(parts["word/document.xml"], /<w:bidi\/>/, "Arapça paragraf sağdan sola");
	assert.match(parts["word/document.xml"], /Kaynakça/);
	assert.match(parts["word/footnotes.xml"], /<w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">Fıkıh Usûlü/);
	assert.match(parts["word/document.xml"], /a &amp; b &lt;c&gt;/);
});

test("Markdown: Pandoc atfı ve biçim", () => {
	let md = E.toMarkdown(doc);
	assert.match(md, /^# Deneme/m);
	assert.match(md, /Bir iddia \[@yilmaz2010fikih, p\. 12\]\./);
	assert.match(md, /^> قال الإمام/m);
	assert.match(md, /^- \*\*a & b \\<c\\>\*\*/m);
});

test("HTML: dipnotlar ve kaynakça", () => {
	let html = E.toHTML(doc.blocks, fmt);
	assert.match(html, /iddia<sup>1<\/sup>/);
	assert.match(html, /<h2>Kaynakça<\/h2>/);
	assert.match(html, /dir="rtl"/);
});
