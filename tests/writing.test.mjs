import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { Hafif } = load("lint", "citekey", "notedoc");
const L = Hafif.modules.lint;
const K = Hafif.modules.citekey;
const D = Hafif.modules.notedoc;

const snap = (type, fields, creators = [{ lastName: "Yılmaz", firstName: "Ahmet", creatorType: "author" }]) =>
	({ type, fields, valid: new Set(Object.keys(fields)), creators });

test("ISBN-10 ve ISBN-13 sağlaması", () => {
	assert.equal(L.isbnValid("975-389-000-6"), false);
	assert.equal(L.isbnValid("0-306-40615-2"), true);
	assert.equal(L.isbnValid("978-0-306-40615-7"), true);
	assert.equal(L.isbnValid("978-0-306-40615-8"), false);
});

test("kitap: eksik yayınevi ve yer bulunur", () => {
	let issues = L.check(snap("book", { title: "Fıkıh Usûlü", place: "", publisher: "", date: "2010" }));
	let msgs = issues.map(i => i.msg).join(" | ");
	assert.match(msgs, /yayın yeri eksik/);
	assert.match(msgs, /yayınevi eksik/);
});

test("büyük harfli başlık ve yazar", () => {
	let issues = L.check(snap("book", { title: "OSMANLI HUKUKU", place: "İstanbul", publisher: "İSAM", date: "2010" },
		[{ lastName: "YILMAZ", firstName: "AHMET", creatorType: "author" }]));
	assert.ok(issues.some(i => i.fix?.action === "titleCase"));
	assert.ok(issues.some(i => i.fix?.action === "fixNames"));
});

test("DOI öneki ve dil adı düzeltmesi önerilir", () => {
	let issues = L.check(snap("journalArticle", { title: "Makale", publicationTitle: "Dergi", date: "2020", pages: "1-10", volume: "3", DOI: "https://doi.org/10.1234/abc", language: "Türkçe" }));
	assert.equal(JSON.stringify(issues.find(i => i.field === "DOI").fix), JSON.stringify({ field: "DOI", value: "10.1234/abc" }));
	assert.equal(JSON.stringify(issues.find(i => i.field === "language").fix), JSON.stringify({ field: "language", value: "tr" }));
});

test("sayfa öneki, ters aralık, uzun tire", () => {
	assert.equal(L.check(snap("journalArticle", { title: "x", publicationTitle: "y", date: "2020", volume: "1", pages: "s. 12-30" })).find(i => i.field === "pages").fix.value, "12-30");
	assert.match(L.check(snap("journalArticle", { title: "x", publicationTitle: "y", date: "2020", volume: "1", pages: "30-12" })).find(i => i.field === "pages").msg, /ters/);
	assert.equal(L.check(snap("journalArticle", { title: "x", publicationTitle: "y", date: "2020", volume: "1", pages: "12–30" })).find(i => i.field === "pages").fix.value, "12-30");
});

test("hicrî yıl ipucu", () => {
	let issues = L.check(snap("book", { title: "Kitâb", place: "Kahire", publisher: "Bulak", date: "1310" }));
	assert.ok(issues.some(i => /hicrî/.test(i.msg)));
});

test("sorunsuz kayıtta uyarı yok", () => {
	let issues = L.check(snap("book", { title: "Osmanlı Hukuku", place: "İstanbul", publisher: "İSAM Yayınları", date: "2010", language: "tr" }));
	assert.equal(issues.length, 0, JSON.stringify(issues));
});

test("atıf anahtarı: Türkçe harfler, takı, durak sözcük", () => {
	assert.equal(K.make("Yılmaz", "2019", "Osmanlı'da Vakıf Hukuku"), "yilmaz2019osmanlida");
	assert.equal(K.make("el-Gazzâlî", "1993", "el-Müstasfâ min ilmi'l-usûl"), "gazzali1993mustasfa");
	assert.match(K.make("", "2000", "The Law"), /^anon2000law$/);
});

test("sağdan sola metin sezimi", () => {
	assert.equal(D.isRTL("قال الإمام الشافعي"), true);
});
