import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { load } from "./harness.mjs";

const { Hafif } = load("search", "verify", "usage");
const V = Hafif.modules.verify;
const U = Hafif.modules.usage;

test("alıntı: birebir ve satır sonu tireli", () => {
	let pages = ["birinci sayfa", "Usûl-i fıkıh, fıkhın delil-\nlerini ve bu delillerden hüküm çıkarma yollarını inceleyen ilimdir.", "son"];
	let r = V.findQuote(pages, "fıkhın delillerini ve bu delillerden hüküm çıkarma yollarını");
	assert.equal(r.index, 1);
	assert.equal(r.score, 1);
});

test("alıntı: aksan ve hareke farkı tolere edilir, yoksa bulunmaz", () => {
	let pages = ["Ebû Hanîfe istihsânı kıyâsın terkedilmesi olarak tanımlar."];
	assert.equal(V.findQuote(pages, "Ebu Hanife istihsanı kıyasın terkedilmesi olarak").score, 1);
	let miss = V.findQuote(pages, "İmam Şâfiî istihsanı kesinlikle reddetmiştir ve bunu bidat saymıştır");
	assert.ok(!miss || miss.weak);
});

test("alıntı: iki sayfaya taşan", () => {
	let pages = ["... hüküm çıkarma yollarını", "inceleyen bir ilimdir. Sonra ..."];
	assert.equal(V.findQuote(pages, "hüküm çıkarma yollarını inceleyen bir ilimdir").index, 0);
});

test("atıf sayfa aralığı", () => {
	assert.equal(V.locatorPages("12-14").join(","), "12,13,14");
	assert.equal(V.locatorPages("xii").join(","), "xii");
});

test("nottan alıntı + atıf çıkarma (vurgudan gelen atlanır)", () => {
	let item = { id: 1 };
	let blocks = [
		{ type: "para", runs: [{ text: "Yazara göre “usûl, fıkhın delillerini inceleyen ilimdir” " }, { cite: [{ item, locator: "12" }] }, { text: "." }] },
		{ type: "para", runs: [{ text: "“vurgudan gelen uzunca bir alıntı metni burada”", source: { item } }, { text: " " }, { cite: [{ item, locator: "3" }] }] },
		{ type: "quote", runs: [{ text: "Blok alıntı da sayılır çünkü uzun bir metindir" }, { cite: [{ item, locator: "40" }] }] },
		{ type: "para", runs: [{ text: "Tırnaksız iddia " }, { cite: [{ item, locator: "9" }] }] },
	];
	let q = V.extractQuotes(blocks);
	assert.equal(q.length, 2);
	assert.equal(q[0].quote, "usûl, fıkhın delillerini inceleyen ilimdir");
	assert.equal(q[0].locator, "12");
	assert.equal(q[1].locator, "40");
});

test("kullanım maliyeti", () => {
	assert.equal(U.cost({ input: 2e6, output: 1e6 }, [3, 15]), 21);
	assert.equal(U.cost({ input: 1 }, undefined), null);
	assert.equal(U.fmtTokens(1530000), "1.53 M");
});

test("vektör puanlama: en iyi K, maske", () => {
	const ctx = {};
	vm.createContext(ctx);
	vm.runInContext(readFileSync(new URL("../zotero-hafif/content/windows/vecmath.js", import.meta.url), "utf8"), ctx);
	const H = vm.runInContext("HafifVec", ctx);
	let dims = 2, n = 5;
	let vec = new Int8Array([127, 0, 0, 127, 90, 90, -127, 0, 120, 10]);
	let scales = new Float32Array(n).fill(1);
	let q = new Int8Array([127, 0]);
	let r = H.topScores(vec, dims, n, scales, q, 1, null, 3);
	assert.deepEqual([...r.idx], [0, 4, 2]);
	let m = H.topScores(vec, dims, n, scales, q, 1, new Uint8Array([0, 1, 1, 1, 1]), 2);
	assert.deepEqual([...m.idx], [4, 2]);
});
