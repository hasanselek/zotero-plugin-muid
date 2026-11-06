import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { Hafif } = load("search");
const S = Hafif.modules.search;

test("normalize: Latin aksanları ve transkripsiyon işaretleri", () => {
	assert.equal(S.normalize("Ebû Hanîfe"), S.normalize("Ebu Hanife"));
	assert.equal(S.normalize("ʿİlm"), S.normalize("ilm"));
});

test("normalize: Arapça hareke", () => {
	assert.equal(S.normalize("كِتَابٌ"), S.normalize("كتاب"));
});
